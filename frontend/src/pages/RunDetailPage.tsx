import { ArrowLeft, Undo2 } from 'lucide-react'
import { Link, useParams } from 'react-router'
import type { Job } from '@/api/client'
import { useJobs, useRun, useUpdateJob } from '@/api/hooks'
import { Chip, VerdictChip } from '@/components/Chip'
import { EmptyState } from '@/components/EmptyState'
import { PageBody, Panel } from '@/components/Panel'
import { RunAccounting, RunErrors, RunSourcesTable } from '@/components/run/RunAccounting'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatUsd } from '@/lib/format'
import { SOURCE_LABELS } from '@/lib/sources'

const STATUS: Record<Job['status'], string> = {
  new: 'New',
  saved: 'Saved',
  applied: 'Applied',
  interview: 'Interview',
  rejected: 'Rejected',
  ignored: 'Ignored',
}

export function RunDetailPage() {
  const runId = Number(useParams().runId)
  const run = useRun(runId)
  const jobs = useJobs({ runId })
  const updateJob = useUpdateJob()

  return (
    <PageBody>
      <Link to="/history" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> History
      </Link>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Run {runId}</h1>
        {run.data ? (
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            started {formatDateTime(run.data.started_at)} · {run.data.state} · est.{' '}
            {formatUsd(run.data.estimated_cost_usd)}
          </p>
        ) : null}
      </header>
      {run.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {run.error.message}
        </p>
      ) : null}
      {run.data ? (
        <>
          <Panel label="Result" className="space-y-4">
            <h2 className="text-xl font-medium">Where the {run.data.fetched} fetched jobs went</h2>
            <RunErrors run={run.data} />
            <RunAccounting run={run.data} />
            <RunSourcesTable run={run.data} />
          </Panel>
          <Panel label="New jobs of this run" className="space-y-4">
            <div>
              <h2 className="text-xl font-medium">Jobs first seen in this run</h2>
              <p className="text-sm text-muted-foreground">Including ignored jobs, which appear nowhere else.</p>
            </div>
            {jobs.isError || updateJob.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {(jobs.error ?? updateJob.error)?.message}
              </p>
            ) : null}
            {jobs.isPending ? (
              <p className="text-sm text-muted-foreground">Loading jobs…</p>
            ) : jobs.data && jobs.data.length === 0 ? (
              <EmptyState title="This run found no new jobs" />
            ) : (
              <ul className="divide-y rounded-md border">
                {(jobs.data ?? []).map((job) => (
                  <li key={job.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <VerdictChip job={job} />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold">{job.title}</h3>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {[job.company, job.location, ...job.sources.map((s) => SOURCE_LABELS[s.source])]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {job.filter_reason ? (
                        <p className="font-mono text-[11px] text-muted-foreground">Filtered out: {job.filter_reason}</p>
                      ) : null}
                    </div>
                    <Chip tone={job.status === 'ignored' ? 'neutral' : job.status === 'new' ? 'neutral' : 'primary'}>
                      {STATUS[job.status]}
                    </Chip>
                    {job.status === 'ignored' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Restore ${job.title}`}
                        onClick={() => updateJob.mutate({ id: job.id, status: 'new' })}
                      >
                        <Undo2 aria-hidden /> Restore
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      ) : null}
    </PageBody>
  )
}
