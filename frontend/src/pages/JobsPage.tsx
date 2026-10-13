import { ArrowLeft, Search } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import type { Job, JobUpdate, SourceName } from '@/api/client'
import { useJobs, useMatchStatus, useReevaluate, useStats, useUpdateJob } from '@/api/hooks'
import { Chip } from '@/components/Chip'
import { EmptyState } from '@/components/EmptyState'
import { ActionBar, LabelBar, type JobAction } from '@/components/jobs/ActionBar'
import { JobBody, JobHeader } from '@/components/jobs/JobDetail'
import { JobListRow } from '@/components/jobs/JobListRow'
import { VerdictBox } from '@/components/jobs/VerdictBox'
import { Kbd } from '@/components/Kbd'
import { Button } from '@/components/ui/button'
import { JOB_VIEWS, type JobView } from '@/lib/job-views'
import { openJob } from '@/lib/jobs'
import { useRunStatus } from '@/lib/run-status'
import { useShortcuts } from '@/lib/shortcuts'
import { SOURCE_LABELS } from '@/lib/sources'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { verdictOf } from '@/lib/verdict'

type Filters = { run: 'all' | 'latest'; source: SourceName | 'all'; remote: Job['remote'] | 'all'; text: string }

const NO_FILTERS: Filters = { run: 'all', source: 'all', remote: 'all', text: '' }
const SELECT = 'h-7 rounded-sm border bg-muted px-1.5 font-mono text-[11px] text-foreground'

const DONE: Record<'applied' | 'saved' | 'ignored', string> = {
  applied: 'marked as applied',
  saved: 'saved',
  ignored: 'ignored',
}

function passes(job: Job, filters: Filters, latestRun: number | undefined): boolean {
  if (filters.run === 'latest' && job.first_seen_run_id !== latestRun) return false
  if (filters.source !== 'all' && !job.sources.some((s) => s.source === filters.source)) return false
  if (filters.remote !== 'all' && job.remote !== filters.remote) return false
  const text = filters.text.trim().toLowerCase()
  return text === '' || `${job.title} ${job.company} ${job.location ?? ''}`.toLowerCase().includes(text)
}

/** Still belongs to the view after an optimistic update? (The server filtered the rest.) */
function inView(job: Job, view: JobView): boolean {
  if (job.status !== 'new') return false
  const verdict = verdictOf(job)
  return (
    (view.slug === 'matches' && verdict === 'match') ||
    (view.slug === 'not-matched' && verdict === 'no_match') ||
    (view.slug === 'undecided' && verdict === 'undecided') ||
    (view.slug === 'filtered' && verdict === 'filtered')
  )
}

function Reevaluate() {
  const status = useMatchStatus()
  const last = status.data
  if (!last) return null
  if (last.running) {
    return (
      <span role="status" className="font-mono text-[11px] text-warn">
        LLM {last.done} / {last.total}
      </span>
    )
  }
  if (last.error) {
    return (
      <span role="alert" className="font-mono text-[11px] text-destructive">
        {last.error}
      </span>
    )
  }
  return last.total > 0 ? (
    <span role="status" className="font-mono text-[11px] text-muted-foreground">
      Last re-evaluation: {last.matched} matched, {last.not_matched} not matched, {last.undecided} still undecided
    </span>
  ) : null
}

export function JobsPage() {
  const params = useParams()
  const navigate = useNavigate()
  const view = JOB_VIEWS.find((candidate) => candidate.slug === params.view)
  if (!view) return <Navigate to="/jobs/matches" replace />
  return <JobsView key={view.slug} view={view} navigate={(to) => void navigate(to)} />
}

function JobsView({ view, navigate }: { view: JobView; navigate: (to: string) => void }) {
  const jobs = useJobs(view.filter)
  const stats = useStats()
  const updateJob = useUpdateJob()
  const reevaluate = useReevaluate()
  const matchStatus = useMatchStatus()
  const toast = useToast()
  const { run } = useRunStatus()
  const searchRef = useRef<HTMLInputElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [chosenId, setChosenId] = useState<number | null>(null)
  const [labelMode, setLabelMode] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false) // narrow windows: list or detail

  const all = jobs.data?.filter((job) => inView(job, view) || (labelMode && job.status === 'new'))
  const visible = all?.filter((job) => passes(job, filters, run?.id))
  // Something is always selected, so the action keys work on arrival.
  const selected = visible?.find((job) => job.id === chosenId) ?? visible?.[0]
  const selectedIndex = selected && visible ? visible.indexOf(selected) : -1
  const latest = visible?.filter((job) => job.first_seen_run_id === run?.id) ?? []
  const earlier = visible?.filter((job) => job.first_seen_run_id !== run?.id) ?? []
  const filtering = all !== undefined && visible !== undefined && visible.length < all.length

  const select = (index: number) => {
    const job = visible?.[Math.max(0, Math.min(index, (visible?.length ?? 1) - 1))]
    if (!job) return
    setChosenId(job.id)
    document.querySelector(`[data-job-id="${job.id}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }

  /** Change a job; when it leaves the view, the next one takes its place and undo is offered. */
  const change = (job: Job, update: JobUpdate, done: string) => {
    const next = visible?.[selectedIndex + 1] ?? visible?.[selectedIndex - 1]
    if (job.id === selected?.id && !labelMode) setChosenId(next?.id ?? null)
    updateJob.mutate({ id: job.id, ...update })
    toast.show(`“${job.title}” ${done}.`, () => {
      updateJob.mutate({ id: job.id, status: job.status, owner_label: job.owner_label })
      setChosenId(job.id) // back to the job that was just restored
    })
  }

  const act = (action: JobAction) => {
    if (!selected) return
    if (action === 'open') openJob(selected)
    else if (action === 'letter') navigate(`/letter/${selected.id}`)
    else change(selected, { status: action }, DONE[action])
  }

  const setVerdict = (label: boolean | null) => {
    if (!selected) return
    const done =
      label === null ? 'verdict cleared' : label ? 'moved to matches' : 'marked as not a match'
    change(selected, { owner_label: label }, done)
  }

  const label = (relevant: boolean) => {
    if (!selected) return
    updateJob.mutate({ id: selected.id, owner_label: relevant })
    select(selectedIndex + 1)
  }

  useShortcuts({
    j: () => select(selectedIndex + 1),
    k: () => select(selectedIndex - 1),
    a: () => !labelMode && act('applied'),
    s: () => !labelMode && act('saved'),
    i: () => !labelMode && act('ignored'),
    o: () => act('open'),
    c: () => act('letter'),
    n: () => (labelMode ? label(false) : setVerdict(selected ? verdictOf(selected) !== 'match' : null)),
    y: () => labelMode && label(true),
    l: () => setLabelMode((on) => !on),
    '/': () => searchRef.current?.focus(),
    ' ': () => detailRef.current?.focus(),
    ...Object.fromEntries(JOB_VIEWS.map((v, index) => [String(index + 1), () => navigate(`/jobs/${v.slug}`)])),
  })

  const reevaluating = matchStatus.data?.running === true || reevaluate.isPending
  const error = jobs.error ?? updateJob.error ?? reevaluate.error

  return (
    <div className="flex h-full flex-col">
      {/* View switch, label mode, search and filters */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-surface-lowest px-6 py-2">
        <nav aria-label="Views" className="flex items-center gap-1 rounded-md border bg-muted p-1">
          {JOB_VIEWS.map((v) => {
            const active = v.slug === view.slug
            const count = active && all && !labelMode ? all.length : stats.data?.[v.stat]
            return (
              <Link
                key={v.slug}
                to={`/jobs/${v.slug}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-sm px-2.5 py-1 font-mono text-xs transition-colors',
                  active
                    ? 'border border-primary/20 bg-surface-highest font-medium'
                    : 'text-muted-foreground hover:bg-surface-high hover:text-foreground',
                )}
              >
                {v.label}
                <span
                  className={cn(
                    'rounded-sm px-1.5 text-[10px]',
                    active ? 'bg-primary/20 text-primary-soft' : 'bg-surface-highest',
                  )}
                >
                  {count ?? '–'}
                </span>
              </Link>
            )
          })}
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground">
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={labelMode}
              aria-keyshortcuts="l"
              onChange={(event) => setLabelMode(event.target.checked)}
            />
            Label mode
          </label>
          <span className="h-4 w-px bg-border" aria-hidden />
          <div className="relative flex items-center">
            <Search className="absolute left-2 size-3.5 text-muted-foreground" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              aria-label="Search"
              aria-keyshortcuts="/"
              placeholder="Search… (/)"
              className="h-7 w-44 rounded-sm border bg-muted pr-2 pl-7 text-[13px] transition-all duration-150 outline-none placeholder:text-muted-foreground focus:w-56 focus:border-primary"
              value={filters.text}
              onChange={(event) => setFilters({ ...filters, text: event.target.value })}
            />
          </div>
          <select
            className={SELECT}
            aria-label="Run"
            value={filters.run}
            onChange={(event) => setFilters({ ...filters, run: event.target.value as Filters['run'] })}
          >
            <option value="all">Run: all</option>
            <option value="latest">Run: latest</option>
          </select>
          <select
            className={SELECT}
            aria-label="Source"
            value={filters.source}
            onChange={(event) => setFilters({ ...filters, source: event.target.value as Filters['source'] })}
          >
            <option value="all">Source: all</option>
            {Object.entries(SOURCE_LABELS).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
          <select
            className={SELECT}
            aria-label="Workplace"
            value={filters.remote}
            onChange={(event) => setFilters({ ...filters, remote: event.target.value as Filters['remote'] })}
          >
            <option value="all">Workplace: any</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">On-site</option>
            <option value="unknown">Not stated</option>
          </select>
          {all ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {filtering ? `${visible.length} of ${all.length}` : all.length} {all.length === 1 ? 'job' : 'jobs'}
            </span>
          ) : null}
        </div>
      </div>

      {labelMode ? (
        <p className="shrink-0 border-b bg-primary/10 px-6 py-1.5 font-mono text-[11px] text-primary-soft">
          Label mode — say for each job whether it is relevant to you.{' '}
          {stats.data
            ? `${stats.data.labelled} labelled so far (${stats.data.labelled_relevant} relevant, ${stats.data.labelled_not_relevant} not relevant); aim for 50 to 100.`
            : ''}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="shrink-0 border-b bg-destructive/10 px-6 py-2 text-sm text-destructive">
          {error.message}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* Feed */}
        <section
          aria-label={`${view.label} list`}
          className={cn(
            'w-full shrink-0 flex-col overflow-y-auto border-r lg:flex lg:w-[380px]',
            detailOpen ? 'hidden' : 'flex',
          )}
        >
          {visible === undefined ? (
            <p className="p-4 text-sm text-muted-foreground">{jobs.isError ? '' : 'Loading jobs…'}</p>
          ) : visible.length === 0 ? (
            <div className="p-4">
              {filtering ? (
                <EmptyState title="Nothing fits these filters">
                  <button
                    type="button"
                    className="underline underline-offset-4"
                    onClick={() => setFilters(NO_FILTERS)}
                  >
                    Clear the filters
                  </button>
                </EmptyState>
              ) : (
                <EmptyState title={view.empty.title}>
                  {view.empty.text}{' '}
                  <Link to="/" className="underline underline-offset-4">
                    Go to Today
                  </Link>
                </EmptyState>
              )}
            </div>
          ) : (
            [
              { title: 'New in latest run', jobs: latest, tone: 'text-match' },
              { title: latest.length > 0 ? 'Earlier' : 'All runs', jobs: earlier, tone: '' },
            ]
              .filter((group) => group.jobs.length > 0)
              .map((group) => (
                <div key={group.title}>
                  <h2 className="sticky top-0 z-10 flex items-center gap-1.5 border-b bg-surface-lowest px-3.5 py-2">
                    <span className={cn('label-mono', group.tone)}>
                      {group.title} ({group.jobs.length})
                    </span>
                  </h2>
                  <ul>
                    {group.jobs.map((job) => (
                      <JobListRow
                        key={job.id}
                        job={job}
                        selected={job.id === selected?.id}
                        onSelect={() => {
                          setChosenId(job.id)
                          setDetailOpen(true)
                        }}
                      />
                    ))}
                  </ul>
                </div>
              ))
          )}
        </section>

        {/* Detail */}
        <section
          aria-label="Selected job"
          className={cn('min-w-0 flex-1 flex-col bg-card lg:flex', detailOpen ? 'flex' : 'hidden')}
        >
          {selected ? (
            <>
              <button
                type="button"
                className="flex items-center gap-1 border-b px-6 py-2 text-sm text-muted-foreground lg:hidden"
                onClick={() => setDetailOpen(false)}
              >
                <ArrowLeft className="size-4" aria-hidden /> Back to the list
              </button>
              <JobHeader job={selected}>
                <VerdictBox
                  job={selected}
                  onVerdict={labelMode ? undefined : setVerdict}
                  onReevaluate={view.slug === 'undecided' ? () => reevaluate.mutate() : undefined}
                  reevaluating={reevaluating}
                />
                {view.slug === 'undecided' ? <Reevaluate /> : null}
              </JobHeader>
              <div ref={detailRef} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto p-6 outline-none">
                <JobBody job={selected} />
              </div>
              <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-background px-6 py-3">
                {labelMode ? (
                  <LabelBar
                    label={selected.owner_label}
                    onLabel={label}
                    onSkip={() => select(selectedIndex + 1)}
                  />
                ) : (
                  <ActionBar onAction={act} />
                )}
                <p className="hidden items-center gap-2 font-mono text-[11px] text-muted-foreground xl:flex">
                  <Kbd>J</Kbd>
                  <Kbd>K</Kbd> next / previous · <Kbd>U</Kbd> undo · <Kbd>?</Kbd> all shortcuts
                </p>
              </footer>
            </>
          ) : visible !== undefined ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="max-w-sm space-y-3 text-center">
                <Chip tone="match" dot>
                  Triage complete
                </Chip>
                <p className="text-sm text-muted-foreground">
                  No job is waiting in “{view.label}”. Applications you saved are on the Tracker.
                </p>
                <div className="flex justify-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link to="/tracker">Go to Tracker</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link to="/">Go to Today</Link>
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
