import type { ReactNode } from 'react'
import { useLatestRun, useRunProgress } from '@/api/hooks'
import { RunStatusContext } from '@/lib/run-status'

/** One subscription to the latest run and its live progress, shared by every page. */
export function RunStatusProvider({ children }: { children: ReactNode }) {
  const latest = useLatestRun()
  const run = latest.data
  const progress = useRunProgress(run?.state === 'running' ? run.id : null)
  return (
    <RunStatusContext.Provider value={{ run, progress, error: latest.error }}>{children}</RunStatusContext.Provider>
  )
}
