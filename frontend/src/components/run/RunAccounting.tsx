import type { Run, SourceName } from '@/api/client'
import { formatPercent, formatUsd } from '@/lib/format'
import { SOURCE_LABELS } from '@/lib/sources'

function Num({ value, tone }: { value: number; tone?: string }) {
  return <span className={`font-medium ${tone ?? 'text-foreground'}`}>{value}</span>
}

function sourceLabel(key: string): string {
  return key in SOURCE_LABELS ? SOURCE_LABELS[key as SourceName] : 'Run'
}

/** Per-source and whole-run errors of a run. */
export function RunErrors({ run }: { run: Run }) {
  const errors = Object.entries(run.errors)
  if (errors.length === 0) return null
  return (
    <ul role="alert" className="space-y-1 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
      {errors.map(([key, message]) => (
        <li key={key}>
          <span className="font-medium">{sourceLabel(key)}:</span> {message}
        </li>
      ))}
    </ul>
  )
}

/** Where every fetched job went: two lines that add up, as returned by the API. */
export function RunAccounting({ run }: { run: Run }) {
  return (
    <div className="space-y-2 font-mono text-xs text-muted-foreground">
      <p aria-label="Fetched" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-background px-3 py-2.5">
        <span className="size-1.5 rounded-full bg-primary-soft" aria-hidden />
        <Num value={run.fetched} /> fetched = <Num value={run.new} tone="text-match" /> new +{' '}
        <Num value={run.already_known} /> already known + <Num value={run.duplicates_in_run} /> repeated
        {run.skipped > 0 ? (
          <>
            {' '}
            + <Num value={run.skipped} tone="text-warn" /> unreadable
          </>
        ) : null}
        <span className="label-mono ml-auto">Fetch</span>
      </p>
      <p aria-label="Evaluated" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-background px-3 py-2.5">
        <span className="size-1.5 rounded-full bg-match" aria-hidden />
        <Num value={run.new} tone="text-match" /> new → <Num value={run.matched} tone="text-match" /> matches ·{' '}
        <Num value={run.not_matched} /> not matched · <Num value={run.undecided} tone="text-warn" /> undecided ·{' '}
        <Num value={run.prefiltered_out} /> filtered out
        <span className="label-mono ml-auto">LLM</span>
      </p>
    </div>
  )
}

/** Counts and estimated cost per source of one run. */
export function RunSourcesTable({ run }: { run: Run }) {
  const sources = Object.entries(run.sources)
  if (sources.length === 0) return null
  return (
    <table className="w-full font-mono text-xs">
      <caption className="label-mono mb-2 text-left">Per source</caption>
      <thead>
        <tr className="border-b text-left text-muted-foreground [&_th]:py-2 [&_th]:font-normal">
          <th>Source</th>
          <th className="text-right">Limit</th>
          <th className="text-right">Fetched</th>
          <th className="text-right">New</th>
          <th className="text-right">Known</th>
          <th className="text-right">Repeated</th>
          <th className="text-right">New / fetched</th>
          <th className="text-right">Cost</th>
        </tr>
      </thead>
      <tbody>
        {sources.map(([name, stats]) => (
          <tr key={name} className="border-b last:border-b-0 [&_td]:py-2.5">
            <th scope="row" className="text-left font-medium">
              <span className="mr-2 inline-block size-1.5 rounded-full bg-primary" aria-hidden />
              {sourceLabel(name)}
            </th>
            <td className="text-right">{stats.limit}</td>
            <td className="text-right">{stats.fetched}</td>
            <td className="text-right text-match">{stats.new}</td>
            <td className="text-right">{stats.known}</td>
            <td className="text-right">{stats.duplicates}</td>
            <td className="text-right">{formatPercent(stats.new, stats.fetched)}</td>
            <td className="text-right">{formatUsd(stats.cost_usd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
