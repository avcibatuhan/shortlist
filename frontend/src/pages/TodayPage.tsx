import { ArrowRight, Bookmark, ChevronDown, CircleCheck, CircleHelp, Loader2, RefreshCw, Send, Timer } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { Limits, Source, SourceName } from '@/api/client'
import { useEstimate, useModels, useSources, useStartRun, useStats } from '@/api/hooks'
import { PageBody, Panel } from '@/components/Panel'
import { BudgetMeter } from '@/components/run/BudgetMeter'
import { RunAccounting, RunErrors, RunSourcesTable } from '@/components/run/RunAccounting'
import { RunStepper } from '@/components/run/RunStepper'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatRelativeTime, formatUsd } from '@/lib/format'
import { useRunStatus } from '@/lib/run-status'
import { SOURCE_LABELS } from '@/lib/sources'
import { cn } from '@/lib/utils'

const MAX_LIMIT = 1000

type Control = { enabled: boolean; limit: string }

const RUN_STATE: Record<'done' | 'partial' | 'failed', string> = {
  done: 'finished',
  partial: 'finished with problems',
  failed: 'failed',
}

function isValidLimit(limit: string): boolean {
  const value = Number(limit)
  return limit.trim() !== '' && Number.isInteger(value) && value >= 1 && value <= MAX_LIMIT
}

function greeting(now: Date = new Date()): string {
  const hour = now.getHours()
  return hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.'
}

function SourceRow({ source, control, onChange }: { source: Source; control: Control; onChange: (c: Control) => void }) {
  const label = SOURCE_LABELS[source.name]
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex w-36 items-center gap-2">
        <Switch
          id={`enabled-${source.name}`}
          checked={control.enabled}
          onCheckedChange={(enabled) => onChange({ ...control, enabled })}
        />
        <Label htmlFor={`enabled-${source.name}`}>{label}</Label>
      </div>
      <Input
        type="number"
        min={1}
        max={MAX_LIMIT}
        step={1}
        className="w-24 font-mono"
        aria-label={`${label} — max results`}
        aria-invalid={control.enabled && !isValidLimit(control.limit)}
        disabled={!control.enabled}
        value={control.limit}
        onChange={(event) => onChange({ ...control, limit: event.target.value })}
      />
      <span className="font-mono text-[11px] text-muted-foreground">
        max results across {source.searches.map((s) => `"${s.keyword}"`).join(', ')}
      </span>
    </li>
  )
}

function Tile({
  icon,
  tag,
  tone,
  value,
  unit,
  label,
  to,
}: {
  icon: ReactNode
  tag: string
  tone: 'match' | 'warn' | 'primary' | 'quiet'
  value: number | undefined
  unit: string
  label: string
  to?: string
}) {
  const quiet = !value
  const color = quiet
    ? 'text-muted-foreground'
    : tone === 'match'
      ? 'text-match'
      : tone === 'warn'
        ? 'text-warn'
        : 'text-primary-soft'
  const body = (
    <>
      <div className="flex items-start justify-between">
        <span className="flex size-9 items-center justify-center rounded-md border bg-surface-high" aria-hidden>
          <span className={color}>{icon}</span>
        </span>
        <span className={cn('font-mono text-xs font-medium', color)}>{tag}</span>
      </div>
      <p className="mt-6 flex items-baseline gap-2">
        <span className={cn('font-mono text-4xl font-semibold', color)}>{value ?? '–'}</span>
        <span className="text-sm text-muted-foreground">{unit}</span>
      </p>
      <p className={cn('mt-1 flex items-center justify-between text-base font-medium', quiet && 'text-muted-foreground')}>
        {label}
        {to && !quiet ? <ArrowRight className="size-4" aria-hidden /> : null}
      </p>
    </>
  )
  const className = cn('block rounded-lg border bg-card p-5', quiet && 'opacity-70')
  return to && !quiet ? (
    <Link to={to} className={cn(className, 'transition-colors hover:border-primary/40 hover:bg-muted')}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

export function TodayPage() {
  const sources = useSources()
  const stats = useStats()
  const models = useModels()
  const startRun = useStartRun()
  const { run, progress, error: runError } = useRunStatus()
  const [edited, setEdited] = useState<Partial<Record<SourceName, Control>>>({})
  const [configOpen, setConfigOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const controlOf = (source: Source): Control =>
    edited[source.name] ?? { enabled: true, limit: String(source.default_limit) }
  const enabled = (sources.data ?? []).filter((source) => controlOf(source).enabled)
  const limitsValid = enabled.length > 0 && enabled.every((source) => isValidLimit(controlOf(source).limit))
  const limits: Limits = limitsValid
    ? Object.fromEntries(enabled.map((source) => [source.name, Number(controlOf(source).limit)]))
    : {}

  const estimate = useEstimate(limits)
  const running = startRun.isPending || run?.state === 'running'
  const overBudget = limitsValid && estimate.data?.exceeds_budget === true
  const start = (confirmOverBudget: boolean) => startRun.mutate({ limits, confirmOverBudget })
  const finished = run && run.state !== 'running' ? run : null

  return (
    <PageBody>
      <header className="border-b pb-5">
        <h1 className="text-[32px] leading-10 font-semibold tracking-tight">Today</h1>
        <p className="mt-1 text-base text-muted-foreground">
          {greeting()}{' '}
          {finished?.finished_at ? (
            <>
              Last fetch: <span className="font-medium text-foreground">{formatRelativeTime(finished.finished_at)}</span>
              <span className="font-mono text-sm">
                {' '}
                · <span className="text-primary-soft">{finished.fetched} fetched</span> ·{' '}
                <span className="text-match">{finished.new} new</span>
              </span>
            </>
          ) : run === null ? (
            'Nothing has been fetched yet.'
          ) : null}
        </p>
      </header>

      <Panel label="Fetch">
        {run?.state === 'running' ? (
          <RunStepper sources={Object.keys(run.limits)} progress={progress} />
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!limitsValid || running) return
              if (overBudget) setConfirmOpen(true)
              else start(false)
            }}
          >
            <div className="flex flex-wrap items-center gap-6">
              <Button type="submit" disabled={running || !limitsValid} className="h-20 w-60 gap-3 text-base font-medium">
                {running ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
                {running ? 'Fetching…' : overBudget ? 'Fetch new jobs…' : 'Fetch new jobs'}
              </Button>
              <div className="min-w-0 flex-1 space-y-1">
                <h2 className="text-sm font-medium">Sources</h2>
                <p className="font-mono text-xs text-muted-foreground">
                  {enabled.length > 0
                    ? enabled.map((s) => `${SOURCE_LABELS[s.name]} ${controlOf(s).limit || '?'}`).join(' · ')
                    : 'No source enabled'}
                </p>
                <button
                  type="button"
                  aria-expanded={configOpen}
                  className="flex items-center gap-1 font-mono text-xs font-medium text-primary-soft hover:underline"
                  onClick={() => setConfigOpen((open) => !open)}
                >
                  Change sources and limits
                  <ChevronDown className={cn('size-3.5 transition-transform', configOpen && 'rotate-180')} aria-hidden />
                </button>
              </div>
              {limitsValid && estimate.data ? (
                <dl aria-label="Cost" className="w-full max-w-sm space-y-2 rounded-md border bg-background p-4">
                  <div className="flex items-center justify-between font-mono text-xs">
                    <dt className="text-muted-foreground">Estimated max cost</dt>
                    <dd className={cn('font-medium', overBudget && 'text-warn')}>
                      up to {formatUsd(estimate.data.max_cost_usd)}
                    </dd>
                  </div>
                  <div>
                    <dt className="sr-only">Budget used this month</dt>
                    <dd>
                      <BudgetMeter spent={estimate.data.month_spent_usd} budget={estimate.data.monthly_budget_usd} />
                    </dd>
                  </div>
                </dl>
              ) : null}
            </div>
            {configOpen ? (
              <ul className="space-y-3 border-t pt-4">
                {(sources.data ?? []).map((source) => (
                  <SourceRow
                    key={source.name}
                    source={source}
                    control={controlOf(source)}
                    onChange={(control) => setEdited((current) => ({ ...current, [source.name]: control }))}
                  />
                ))}
              </ul>
            ) : null}
            {sources.data && !limitsValid ? (
              <p className="text-sm text-destructive">
                {enabled.length === 0
                  ? 'Enable at least one source.'
                  : `Enter a whole number from 1 to ${MAX_LIMIT} for every enabled source.`}
              </p>
            ) : null}
            {overBudget ? (
              <p className="text-sm text-warn">
                This run could take this month's cost over the budget. You will be asked to confirm.
              </p>
            ) : null}
            {[sources.error, estimate.error, startRun.error, runError].map((error) =>
              error ? (
                <p key={error.message} role="alert" className="text-sm text-destructive">
                  {error.message}
                </p>
              ) : null,
            )}
          </form>
        )}
      </Panel>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run over the monthly budget?</AlertDialogTitle>
            <AlertDialogDescription>
              {estimate.data
                ? `This run can cost up to ${formatUsd(estimate.data.max_cost_usd)}. With ${formatUsd(estimate.data.month_spent_usd)} already spent this month, that exceeds your ${formatUsd(estimate.data.monthly_budget_usd)} budget.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => start(true)}>Run anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section aria-label="Needs attention" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          icon={<CircleCheck className="size-5" />}
          tag="Matches"
          tone="match"
          value={stats.data?.new_matches}
          unit="postings"
          label="matches to review"
          to="/jobs/matches"
        />
        <Tile
          icon={<CircleHelp className="size-5" />}
          tag="Undecided"
          tone="warn"
          value={stats.data?.new_undecided}
          unit="waiting"
          label="undecided"
          to="/jobs/undecided"
        />
        <Tile
          icon={<Bookmark className="size-5" />}
          tag="Saved"
          tone="warn"
          value={stats.data?.saved}
          unit="saved"
          label="saved, not applied"
          to="/tracker"
        />
        <Tile
          icon={<Send className="size-5" />}
          tag="This week"
          tone="primary"
          value={stats.data?.applied_this_week}
          unit="sent"
          label="applied this week"
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        {finished ? (
          <Panel label="Last run" className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-medium">
                Last run: {RUN_STATE[finished.state as keyof typeof RUN_STATE]}
                {finished.finished_at ? (
                  <span className="text-muted-foreground"> · {formatRelativeTime(finished.finished_at)}</span>
                ) : null}
              </h2>
              <div className="flex items-center gap-4 font-mono text-xs">
                <span className="text-muted-foreground">est. {formatUsd(finished.estimated_cost_usd)}</span>
                <Link to={`/history/${finished.id}`} className="flex items-center gap-1 text-primary-soft hover:underline">
                  Open details <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </div>
            </div>
            <RunErrors run={finished} />
            <RunAccounting run={finished} />
            <RunSourcesTable run={finished} />
            <Button asChild variant="outline">
              <Link to="/jobs/matches">Show matches</Link>
            </Button>
          </Panel>
        ) : run === undefined || run?.state === 'running' ? (
          <div aria-hidden className="rounded-lg border border-dashed" />
        ) : (
          <Panel label="Getting started">
            <h2 className="text-xl font-medium">No run yet</h2>
            <p className="mt-2 max-w-prose text-sm text-muted-foreground">
              “Fetch new jobs” asks the enabled job boards for their newest postings, drops what was seen
              before, and lets the local LLM decide which of the new ones fit your profile. Each result is
              billed by Apify; the estimate above is the most this run can cost.
            </p>
          </Panel>
        )}

        <Panel label="Next steps" className="space-y-4">
          <h2 className="flex items-center gap-2 text-xl font-medium">
            <Timer className="size-5 text-match" aria-hidden /> Next steps
          </h2>
          <ol className="space-y-3 border-t pt-4 text-sm">
            <Step done={!stats.data?.new_matches} to="/jobs/matches" title="Review the matches">
              {stats.data?.new_matches
                ? `${stats.data.new_matches} waiting. Press A to mark applied, S to save, I to ignore.`
                : 'Nothing is waiting.'}
            </Step>
            <Step done={!stats.data?.new_undecided} to="/jobs/undecided" title="Re-evaluate undecided jobs">
              {stats.data?.new_undecided
                ? `${stats.data.new_undecided} jobs have no decision yet.`
                : 'Every job has a decision.'}
            </Step>
            <Step done={!stats.data?.saved} to="/tracker" title="Apply to saved jobs">
              {stats.data?.saved
                ? `${stats.data.saved} saved ${stats.data.saved === 1 ? 'job waits' : 'jobs wait'} for an application; a cover letter draft is one click away.`
                : 'No saved job is waiting.'}
            </Step>
          </ol>
          <dl className="space-y-1.5 rounded-md border bg-background p-3 font-mono text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Model</dt>
              <dd className="truncate text-primary-soft">{models.data?.current ?? '…'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Labelled for evaluation</dt>
              <dd>{stats.data ? `${stats.data.labelled} jobs` : '…'}</dd>
            </div>
          </dl>
        </Panel>
      </div>
    </PageBody>
  )
}

function Step({ done, to, title, children }: { done: boolean; to: string; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      {done ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-match" aria-label="Done" />
      ) : (
        <span className="mt-0.5 size-4 shrink-0 rounded-full border-2 border-muted-foreground" aria-label="To do" />
      )}
      <div>
        <Link to={to} className="font-medium hover:underline">
          {title}
        </Link>
        <p className="text-[13px] text-muted-foreground">{children}</p>
      </div>
    </li>
  )
}
