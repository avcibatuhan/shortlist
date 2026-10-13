import { CircleAlert, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import type { Run, SourceName } from '@/api/client'
import { useMonthlyCosts, useRuns, useSettings } from '@/api/hooks'
import { Chip } from '@/components/Chip'
import { EmptyState } from '@/components/EmptyState'
import { PageBody, Panel } from '@/components/Panel'
import { BudgetMeter } from '@/components/run/BudgetMeter'
import { RunAccounting, RunSourcesTable } from '@/components/run/RunAccounting'
import { formatMonth, formatRelativeTime, formatUsd } from '@/lib/format'
import { SOURCE_LABELS } from '@/lib/sources'
import type { Tone } from '@/lib/verdict'

const STATE: Record<Run['state'], { label: string; tone: Tone }> = {
  running: { label: 'Running', tone: 'primary' },
  done: { label: 'Done', tone: 'match' },
  partial: { label: 'Partial', tone: 'warn' },
  failed: { label: 'Failed', tone: 'error' },
}

function limitsText(run: Run): string {
  return Object.entries(run.limits)
    .map(([name, limit]) => `${SOURCE_LABELS[name as SourceName] ?? name} ${limit}`)
    .join(' · ')
}

function errorsText(run: Run): string {
  return Object.entries(run.errors)
    .map(([name, message]) => `${name in SOURCE_LABELS ? SOURCE_LABELS[name as SourceName] : 'Run'}: ${message}`)
    .join(' | ')
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <dt className="label-mono">{label}</dt>
      <dd className="mt-2 font-mono text-xl font-semibold text-primary-soft">{value}</dd>
      <dd className="mt-1 font-mono text-[11px] text-muted-foreground">{hint}</dd>
    </div>
  )
}

export function HistoryPage() {
  const runs = useRuns()
  const costs = useMonthlyCosts()
  const settings = useSettings()

  const month = costs.data?.[0]
  const latest = runs.data?.find((run) => run.state !== 'running')

  return (
    <PageBody>
      <h1 className="sr-only">History</h1>
      {runs.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {runs.error.message}
        </p>
      ) : runs.isPending ? (
        <p className="text-sm text-muted-foreground">Loading runs…</p>
      ) : runs.data.length === 0 ? (
        <EmptyState title="No runs yet">
          <Link to="/" className="underline underline-offset-4">
            Fetch new jobs
          </Link>{' '}
          on the Today page.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-[5fr_7fr]">
            {month ? (
              <Panel label="Cost this month" className="space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-xl font-medium">
                    <span className="size-2.5 rounded-full bg-match" aria-hidden /> Estimated Apify cost
                  </h2>
                  <span className="font-mono text-xs text-muted-foreground">{formatMonth(month.month)}</span>
                </div>
                <p className="font-mono text-4xl font-semibold">{formatUsd(month.cost_usd)}</p>
                {settings.data ? (
                  <BudgetMeter spent={month.cost_usd} budget={settings.data.monthly_budget_usd} />
                ) : null}
                <dl className="grid grid-cols-2 gap-3">
                  <Stat label="Runs" value={String(month.runs)} hint="started from the app" />
                  <Stat
                    label="Avg cost / run"
                    value={formatUsd(month.cost_usd / month.runs)}
                    hint="estimate, Apify only"
                  />
                </dl>
                {costs.data && costs.data.length > 1 ? (
                  <ul aria-label="Earlier months" className="space-y-1 border-t pt-3 font-mono text-xs">
                    {costs.data.slice(1, 6).map((earlier) => (
                      <li key={earlier.month} className="flex justify-between text-muted-foreground">
                        <span>
                          {formatMonth(earlier.month)} · {earlier.runs} {earlier.runs === 1 ? 'run' : 'runs'}
                        </span>
                        <span className="text-foreground">{formatUsd(earlier.cost_usd)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="font-mono text-[11px] text-muted-foreground">
                  Estimated by the app. Runs started in the Apify console are not included.
                </p>
              </Panel>
            ) : null}
            {latest ? (
              <Panel label="Latest run" className="space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-xl font-medium">Run #{latest.id}: where the jobs went</h2>
                  <Link to={`/history/${latest.id}`} className="font-mono text-xs text-primary-soft hover:underline">
                    {formatRelativeTime(latest.started_at)} · open
                  </Link>
                </div>
                <RunAccounting run={latest} />
                <RunSourcesTable run={latest} />
              </Panel>
            ) : null}
          </div>

          <Panel label="Runs" className="space-y-4">
            <div>
              <h2 className="text-xl font-medium">Runs</h2>
              <p className="text-sm text-muted-foreground">Every fetch started from the app, newest first.</p>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[760px] font-mono text-xs">
                <thead>
                  <tr className="label-mono border-b bg-background text-left [&_th]:px-4 [&_th]:py-3 [&_th]:font-medium">
                    <th>Run</th>
                    <th>Started</th>
                    <th>Status</th>
                    <th>Limits</th>
                    <th className="text-right">Fetched / new</th>
                    <th className="text-right">Matches</th>
                    <th className="text-right">Cost</th>
                    <th>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data.map((run) => {
                    const state = STATE[run.state]
                    const errors = errorsText(run)
                    return (
                      <tr key={run.id} className="border-b last:border-b-0 hover:bg-muted [&_td]:px-4 [&_td]:py-3.5">
                        <th scope="row" className="px-4 text-left text-sm font-semibold">
                          <Link to={`/history/${run.id}`} className="hover:text-primary-soft hover:underline">
                            #{run.id}
                          </Link>
                        </th>
                        <td>{formatRelativeTime(run.started_at)}</td>
                        <td>
                          <Chip tone={state.tone} dot={run.state === 'done'}>
                            {run.state === 'partial' ? <TriangleAlert className="size-3" aria-hidden /> : null}
                            {state.label}
                          </Chip>
                        </td>
                        <td className="text-muted-foreground">{limitsText(run)}</td>
                        <td className="text-right">
                          {run.fetched} / <span className="text-match">{run.new} new</span>
                        </td>
                        <td className="text-right">{run.matched}</td>
                        <td className="text-right">{formatUsd(run.estimated_cost_usd)}</td>
                        <td className="max-w-56">
                          {errors ? (
                            <span className="flex items-center gap-1.5 text-destructive" title={errors}>
                              <CircleAlert className="size-3.5 shrink-0" aria-hidden />
                              <span className="truncate">{errors}</span>
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </PageBody>
  )
}
