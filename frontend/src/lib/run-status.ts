import { createContext, useContext } from 'react'
import type { Run, RunProgress } from '@/api/client'

export type RunStatus = {
  /** The most recent run; null when there is none, undefined while loading. */
  run: Run | null | undefined
  /** Live progress while that run is active. */
  progress: RunProgress | null
  error: Error | null
}

export const RunStatusContext = createContext<RunStatus>({ run: undefined, progress: null, error: null })

export function useRunStatus(): RunStatus {
  return useContext(RunStatusContext)
}

/** "Fetching 2/3", "LLM 12 / 40" — the short text of an active run. */
export function progressText(run: Run, progress: RunProgress | null): string {
  if (progress?.stage === 'matching') return `LLM ${progress.llm_done} / ${progress.llm_total}`
  if (progress?.stage === 'deduplicating') return 'Deduplicating'
  const sources = Object.values(progress?.sources ?? {})
  const finished = sources.filter((source) => source.state === 'done' || source.state === 'error').length
  return `Fetching ${finished}/${Object.keys(run.limits).length}`
}
