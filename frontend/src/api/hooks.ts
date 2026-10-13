import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  api,
  errorMessage,
  type CoverLetter,
  type Decision,
  type Estimate,
  type Job,
  type Limits,
  type JobUpdate,
  type MatchStatus,
  type ModelTest,
  type Models,
  type MonthCost,
  type Run,
  type RunProgress,
  type Settings,
  type SettingsBody,
  type Source,
  type Stats,
} from './client'

// Fallback while a run is active, in case the live event stream drops.
const RUN_POLL_MS = 3000
const MATCH_POLL_MS = 1000

/** Backend and database state, with how long the check took (measured in the browser). */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const started = performance.now()
      const { data, error } = await api.GET('/api/health')
      if (error !== undefined || data === undefined) {
        throw new Error('Health check failed')
      }
      return { ...data, latencyMs: Math.round(performance.now() - started) }
    },
    retry: false,
    refetchInterval: 15_000,
  })
}

export function useSources() {
  return useQuery({
    queryKey: ['sources'],
    queryFn: async (): Promise<Source[]> => {
      const { data, error } = await api.GET('/api/sources')
      if (data === undefined) throw new Error(errorMessage(error, 'Could not load the sources.'))
      return data
    },
  })
}

/** Maximum cost of a run with these limits, this month's cost and the budget. */
export function useEstimate(limits: Limits) {
  return useQuery({
    queryKey: ['estimate', limits],
    queryFn: async (): Promise<Estimate> => {
      const { data, error } = await api.POST('/api/runs/estimate', { body: { limits } })
      if (data === undefined) throw new Error(errorMessage(error, 'Could not estimate the cost.'))
      return data
    },
    enabled: Object.keys(limits).length > 0,
    placeholderData: keepPreviousData,
  })
}

export function useRuns(limit = 50) {
  return useQuery({
    queryKey: ['runs', 'list', limit],
    queryFn: async (): Promise<Run[]> => {
      const { data, error } = await api.GET('/api/runs', { params: { query: { limit } } })
      if (data === undefined) throw new Error(errorMessage(error, 'Could not load the runs.'))
      return data
    },
  })
}

export function useRun(id: number) {
  return useQuery({
    queryKey: ['runs', 'detail', id],
    queryFn: async (): Promise<Run> => {
      const { data, error } = await api.GET('/api/runs/{run_id}', { params: { path: { run_id: id } } })
      if (data === undefined) throw new Error(errorMessage(error, 'Could not load the run.'))
      return data
    },
  })
}

export function useMonthlyCosts() {
  return useQuery({
    queryKey: ['runs', 'costs'],
    queryFn: async (): Promise<MonthCost[]> => {
      const { data, error } = await api.GET('/api/runs/costs')
      if (data === undefined) throw new Error(errorMessage(error, 'Could not load the costs.'))
      return data
    },
  })
}

/** The most recent run (or null). */
export function useLatestRun() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['runs', 'latest'],
    queryFn: async (): Promise<Run | null> => {
      const { data, error } = await api.GET('/api/runs', { params: { query: { limit: 1 } } })
      if (data === undefined) throw new Error(errorMessage(error, 'Could not load the last run.'))
      return data[0] ?? null
    },
    refetchInterval: (q) => (q.state.data?.state === 'running' ? RUN_POLL_MS : false),
  })

  const state = query.data?.state
  useEffect(() => {
    // A finished run may have added jobs and cost.
    if (state !== undefined && state !== 'running') {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['estimate'] })
      void queryClient.invalidateQueries({ queryKey: ['match-status'] })
      void queryClient.invalidateQueries({ queryKey: ['stats'] })
    }
  }, [state, queryClient])

  return query
}

/** Live progress of an active run over Server-Sent Events; null until the first event. */
export function useRunProgress(runId: number | null) {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<RunProgress | null>(null)

  useEffect(() => {
    if (runId === null || typeof EventSource === 'undefined') return
    const events = new EventSource(`/api/runs/${runId}/events`)
    events.onmessage = (event: MessageEvent<string>) => {
      const next: RunProgress = JSON.parse(event.data)
      setProgress(next)
      if (next.stage === 'done' || next.stage === 'failed') {
        events.close()
        void queryClient.invalidateQueries({ queryKey: ['runs'] })
      }
    }
    // No automatic reconnect: the latest-run query keeps polling as a fallback.
    events.onerror = () => events.close()
    return () => events.close()
  }, [runId, queryClient])

  return progress !== null && progress.run_id === runId ? progress : null
}

export function useStartRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { limits: Limits; confirmOverBudget: boolean }): Promise<Run> => {
      const { data, error } = await api.POST('/api/runs', {
        body: { limits: input.limits, confirm_over_budget: input.confirmOverBudget },
      })
      if (data === undefined) throw new Error(errorMessage(error, 'Could not start the run.'))
      return data
    },
    onSuccess: (run) => queryClient.setQueryData(['runs', 'latest'], run),
  })
}

export type JobFilter = {
  status?: Job['status']
  tracked?: boolean
  runId?: number
  filtered?: boolean
  decision?: Decision
}

export function useJobs(filter: JobFilter) {
  return useQuery({
    queryKey: ['jobs', filter],
    queryFn: async (): Promise<Job[]> => {
      const { data, error } = await api.GET('/api/jobs', {
        params: {
          query: {
            status: filter.status,
            tracked: filter.tracked,
            run_id: filter.runId,
            filtered: filter.filtered,
            decision: filter.decision,
          },
        },
      })
      if (data === undefined) throw new Error(errorMessage(error, 'Could not load jobs.'))
      return data
    },
  })
}

/**
 * Change a job's status, note or owner verdict. The change shows at once in every loaded
 * job list (pages filter their list, so a card leaves its page immediately) and is rolled
 * back if the request fails.
 */
export function useUpdateJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: JobUpdate & { id: number }): Promise<Job> => {
      const { data, error } = await api.PATCH('/api/jobs/{job_id}', {
        params: { path: { job_id: id } },
        body,
      })
      if (data === undefined) throw new Error(errorMessage(error, 'Could not update the job.'))
      return data
    },
    onMutate: async ({ id, ...change }) => {
      await queryClient.cancelQueries({ queryKey: ['jobs'] })
      const previous = queryClient.getQueriesData<Job[] | Job>({ queryKey: ['jobs'] })
      queryClient.setQueriesData<Job[] | Job>({ queryKey: ['jobs'] }, (cached) => {
        const apply = (job: Job) => (job.id === id ? { ...job, ...definedOnly(change) } : job)
        return Array.isArray(cached) ? cached.map(apply) : cached ? apply(cached) : cached
      })
      return { previous }
    },
    onError: (_error, _input, context) => {
      for (const [key, jobs] of context?.previous ?? []) queryClient.setQueryData(key, jobs)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['stats'] })
      void queryClient.invalidateQueries({ queryKey: ['match-status'] })
    },
  })
}

/** The fields of a job update that were actually sent (`owner_label: null` is a value). */
function definedOnly(change: JobUpdate): Partial<Job> {
  const result: Partial<Job> = {}
  if (change.status != null) result.status = change.status
  if (change.note != null) result.note = change.note
  if (change.owner_label !== undefined) result.owner_label = change.owner_label
  return result
}

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: async (): Promise<Stats> => {
      const { data, error } = await api.GET('/api/stats')
      if (data === undefined) throw new Error(errorMessage(error, 'Could not load the counters.'))
      return data
    },
  })
}

/** Re-evaluation of undecided jobs: progress while it runs, and how many jobs are waiting. */
export function useMatchStatus() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['match-status'],
    queryFn: async (): Promise<MatchStatus> => {
      const { data, error } = await api.GET('/api/match/status')
      if (data === undefined) throw new Error(errorMessage(error, 'Could not load the LLM status.'))
      return data
    },
    refetchInterval: (q) => (q.state.data?.running ? MATCH_POLL_MS : false),
  })

  const running = query.data?.running
  useEffect(() => {
    // Decisions changed: the job lists are stale.
    if (running === false) void queryClient.invalidateQueries({ queryKey: ['jobs'] })
  }, [running, queryClient])

  return query
}

export function useReevaluate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<MatchStatus> => {
      const { data, error } = await api.POST('/api/match/reevaluate')
      if (data === undefined) throw new Error(errorMessage(error, 'Could not start the re-evaluation.'))
      return data
    },
    onSuccess: (status) => queryClient.setQueryData(['match-status'], status),
  })
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings', 'all'],
    queryFn: async (): Promise<Settings> => {
      const { data, error } = await api.GET('/api/settings')
      if (data === undefined) throw new Error(errorMessage(error, 'Could not load the settings.'))
      return data
    },
  })
}

export function useSaveSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: SettingsBody): Promise<Settings> => {
      const { data, error } = await api.PUT('/api/settings', { body })
      if (data === undefined) throw new Error(errorMessage(error, 'Could not save the settings.'))
      return data
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(['settings', 'all'], settings)
      void queryClient.invalidateQueries({ queryKey: ['settings', 'models'] })
      // Searches, default limits, prices and budget feed the Run page.
      void queryClient.invalidateQueries({ queryKey: ['sources'] })
      void queryClient.invalidateQueries({ queryKey: ['estimate'] })
    },
  })
}

export function useTestModel() {
  return useMutation({
    mutationFn: async (): Promise<ModelTest> => {
      const { data, error } = await api.POST('/api/settings/model/test')
      if (data === undefined) throw new Error(errorMessage(error, 'Could not test the model.'))
      return data
    },
  })
}

/** The model in use and the models installed in Ollama. */
export function useModels() {
  return useQuery({
    queryKey: ['settings', 'models'],
    queryFn: async (): Promise<Models> => {
      const { data, error } = await api.GET('/api/settings/models')
      if (data === undefined) throw new Error(errorMessage(error, 'Could not load the models.'))
      return data
    },
  })
}

export function useChooseModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (modelName: string): Promise<string> => {
      const { data, error } = await api.PUT('/api/settings/model', { body: { model_name: modelName } })
      if (data === undefined) throw new Error(errorMessage(error, 'Could not switch the model.'))
      return data.model_name
    },
    // Both the picker and the Settings form show the model.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })
}

/** The stored cover letter of a job; null when none has been written yet. */
export function useCoverLetter(jobId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['cover-letter', jobId],
    queryFn: async (): Promise<CoverLetter | null> => {
      const { data, error, response } = await api.GET('/api/jobs/{job_id}/cover-letter', {
        params: { path: { job_id: jobId } },
      })
      if (response.status === 404) return null
      if (data === undefined) throw new Error(errorMessage(error, 'Could not load the cover letter.'))
      return data
    },
    enabled,
  })
}

/** Let the LLM write (or rewrite) the cover letter of a job. Takes a while. */
export function useWriteCoverLetter(jobId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<CoverLetter> => {
      const { data, error } = await api.POST('/api/jobs/{job_id}/cover-letter', {
        params: { path: { job_id: jobId } },
      })
      if (data === undefined) throw new Error(errorMessage(error, 'Could not write the cover letter.'))
      return data
    },
    onSuccess: (letter) => queryClient.setQueryData(['cover-letter', jobId], letter),
  })
}

export function useSaveCoverLetter(jobId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (text: string): Promise<CoverLetter> => {
      const { data, error } = await api.PUT('/api/jobs/{job_id}/cover-letter', {
        params: { path: { job_id: jobId } },
        body: { text },
      })
      if (data === undefined) throw new Error(errorMessage(error, 'Could not save the cover letter.'))
      return data
    },
    onSuccess: (letter) => queryClient.setQueryData(['cover-letter', jobId], letter),
  })
}

export function useJob(jobId: number) {
  return useQuery({
    queryKey: ['jobs', 'one', jobId],
    queryFn: async (): Promise<Job> => {
      const { data, error } = await api.GET('/api/jobs/{job_id}', { params: { path: { job_id: jobId } } })
      if (data === undefined) throw new Error(errorMessage(error, 'Could not load the job.'))
      return data
    },
  })
}

/** The saved cover letter as a PDF file, with the file name the backend suggests. */
export async function fetchCoverLetterPdf(jobId: number): Promise<{ blob: Blob; filename: string }> {
  const { data, error, response } = await api.GET('/api/jobs/{job_id}/cover-letter/pdf', {
    params: { path: { job_id: jobId } },
    parseAs: 'blob',
  })
  if (data === undefined) throw new Error(errorMessage(error, 'Could not create the PDF.'))
  const named = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')
  return { blob: data, filename: named?.[1] ?? 'cover-letter.pdf' }
}
