import { ArrowRight, Clock, FileText, Search, StickyNote, Undo2, X, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import type { Job } from '@/api/client'
import { useJobs, useStats, useUpdateJob } from '@/api/hooks'
import { Chip, SourceLink } from '@/components/Chip'
import { EmptyState } from '@/components/EmptyState'
import { JobBody } from '@/components/jobs/JobDetail'
import { Kbd } from '@/components/Kbd'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { daysBetween, formatDateTime } from '@/lib/format'
import { useShortcuts } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'

type Status = Job['status']
type Stage = 'saved' | 'applied' | 'interview' | 'rejected'

const STAGES: { status: Stage; label: string; verb: string; tone: string; staleAfterDays?: number }[] = [
  { status: 'saved', label: 'Saved', verb: 'saved', tone: 'bg-muted-foreground', staleAfterDays: 14 },
  { status: 'applied', label: 'Applied', verb: 'applied', tone: 'bg-primary', staleAfterDays: 21 },
  { status: 'interview', label: 'Interview', verb: 'interview since', tone: 'bg-match' },
  { status: 'rejected', label: 'Rejected', verb: 'rejected', tone: 'bg-muted-foreground/50' },
]

function age(job: Job): { text: string; days: number } | null {
  if (!job.status_changed_at) return null
  const days = daysBetween(job.status_changed_at)
  const stage = STAGES.find((s) => s.status === job.status)
  const when = days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
  return { text: `${stage?.verb ?? job.status} ${when}`, days }
}

function isStale(job: Job): boolean {
  const limit = STAGES.find((s) => s.status === job.status)?.staleAfterDays
  const since = age(job)
  return limit !== undefined && since !== null && since.days > limit
}

function TrackerCard({ job, selected, onSelect }: { job: Job; selected: boolean; onSelect: () => void }) {
  const since = age(job)
  const facts = [job.company, job.location].filter(Boolean).join(' · ')
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected || undefined}
        className={cn(
          'w-full space-y-2 rounded-lg border bg-background p-3.5 text-left transition-colors hover:border-primary/40',
          selected && 'border-primary ring-1 ring-primary',
        )}
      >
        <span className="block text-sm leading-snug font-semibold">{job.title}</span>
        {facts ? <span className="block text-[13px] text-muted-foreground">{facts}</span> : null}
        {isStale(job) ? (
          <Chip tone="warn">
            <Clock className="size-3" aria-hidden /> no change for {since?.days} days
          </Chip>
        ) : null}
        {since ? (
          <span className="block border-t pt-2 font-mono text-[11px] text-muted-foreground" title={formatDateTime(job.status_changed_at ?? '')}>
            {since.text}
          </span>
        ) : null}
        {job.note ? (
          <span className="flex items-start gap-1.5 rounded-sm bg-muted px-2 py-1.5 text-[13px]">
            <StickyNote className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
            <span className="line-clamp-2">{job.note}</span>
          </span>
        ) : null}
      </button>
    </li>
  )
}

function Record({ job, onClose }: { job: Job; onClose: () => void }) {
  const updateJob = useUpdateJob()
  const [note, setNote] = useState(job.note)
  const stageIndex = STAGES.findIndex((stage) => stage.status === job.status)
  const next = STAGES[stageIndex + 1]
  const move = (status: Status) => updateJob.mutate({ id: job.id, status })
  const since = age(job)

  return (
    <aside aria-label="Tracker record" className="flex w-full shrink-0 flex-col border-l bg-card lg:w-[520px]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
        <p className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
          <Chip tone="primary">Tracker record</Chip> #{job.id}
        </p>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close record">
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
        <div className="space-y-1">
          <p className="text-sm text-primary-soft">{job.company}</p>
          <h2 className="text-2xl leading-8 font-semibold tracking-tight">{job.title}</h2>
          <p className="text-sm text-muted-foreground">{[job.location, since?.text].filter(Boolean).join(' · ')}</p>
        </div>

        <section aria-label="Stage" className="space-y-2">
          <h3 className="label-mono">Stage</h3>
          <div role="radiogroup" aria-label="Stage" className="grid grid-cols-4 gap-1 rounded-md border bg-background p-1">
            {STAGES.map((stage) => (
              <button
                key={stage.status}
                type="button"
                role="radio"
                aria-checked={stage.status === job.status}
                onClick={() => move(stage.status)}
                className={cn(
                  'rounded-sm px-2 py-1.5 font-mono text-xs transition-colors',
                  stage.status === job.status
                    ? 'bg-primary font-medium text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {stage.label}
              </button>
            ))}
          </div>
          <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
            <button type="button" className="flex items-center gap-1 underline underline-offset-4 hover:text-foreground" onClick={() => move('new')}>
              <Undo2 className="size-3" aria-hidden /> Move back to new
            </button>
            <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => move('ignored')}>
              <EyeOff className="size-3" aria-hidden /> Ignore job
            </button>
          </div>
        </section>

        <section aria-label="Cover letter" className="flex items-center justify-between gap-3 rounded-lg border bg-background p-4">
          <div className="flex items-center gap-3">
            <FileText className="size-5 text-match" aria-hidden />
            <div>
              <h3 className="text-sm font-semibold">Cover letter</h3>
              <p className="font-mono text-[11px] text-muted-foreground">Write, edit and copy a one-page draft</p>
            </div>
          </div>
          <Button asChild variant="outline">
            <Link to={`/letter/${job.id}`}>
              Open cover letter <ArrowRight aria-hidden />
            </Link>
          </Button>
        </section>

        <section aria-label="Notes" className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="label-mono">Notes</h3>
            <span role="status" className="font-mono text-[11px] text-muted-foreground">
              {updateJob.isPending ? 'Saving…' : note.trim() === job.note ? 'Saved' : 'Not saved yet'}
            </span>
          </div>
          <Textarea
            rows={4}
            maxLength={2000}
            placeholder="Who you talked to, what comes next…"
            aria-label={`Note for ${job.title}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => {
              if (note.trim() !== job.note) updateJob.mutate({ id: job.id, note })
            }}
          />
        </section>

        <div className="flex flex-wrap gap-2">
          {job.sources.map((source) => (
            <SourceLink key={`${source.source}:${source.url}`} source={source} />
          ))}
        </div>
        <JobBody job={job} />
        {updateJob.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {updateJob.error.message}
          </p>
        ) : null}
      </div>
      {next ? (
        <footer className="flex shrink-0 justify-end border-t px-6 py-3">
          <Button onClick={() => move(next.status)} aria-keyshortcuts="ArrowRight">
            Move to {next.label} <ArrowRight aria-hidden />
          </Button>
        </footer>
      ) : null}
    </aside>
  )
}

export function TrackerPage() {
  const jobs = useJobs({ tracked: true })
  const stats = useStats()
  const updateJob = useUpdateJob()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [showRejected, setShowRejected] = useState(false)

  const tracked = (jobs.data ?? []).filter((job) => STAGES.some((stage) => stage.status === job.status))
  const needle = text.trim().toLowerCase()
  const shown = tracked.filter((job) => needle === '' || `${job.title} ${job.company}`.toLowerCase().includes(needle))
  const selected = tracked.find((job) => job.id === selectedId) ?? null

  const shift = (by: 1 | -1) => {
    if (!selected) return
    const target = STAGES[STAGES.findIndex((stage) => stage.status === selected.status) + by]
    if (target) updateJob.mutate({ id: selected.id, status: target.status })
  }
  useShortcuts({
    ArrowRight: () => shift(1),
    ArrowLeft: () => shift(-1),
    Escape: () => setSelectedId(null),
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b bg-surface-lowest px-6 py-2">
        <ul aria-label="Stages" className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs">
          {STAGES.map((stage) => (
            <li key={stage.status} className="flex items-center gap-1.5">
              <span className={cn('size-1.5 rounded-full', stage.tone)} aria-hidden />
              <span className="font-medium">{tracked.filter((job) => job.status === stage.status).length}</span>
              <span className="text-muted-foreground">{stage.label}</span>
            </li>
          ))}
        </ul>
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs">
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Applied this week</dt>
            <dd className="font-medium text-primary-soft">{stats.data?.applied_this_week ?? '–'}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Interviews in total</dt>
            <dd className="font-medium text-match">{stats.data?.interviews_total ?? '–'}</dd>
          </div>
        </dl>
        <div className="flex items-center gap-3">
          <div className="relative flex items-center">
            <Search className="absolute left-2 size-3.5 text-muted-foreground" aria-hidden />
            <input
              type="search"
              aria-label="Filter tracked jobs"
              placeholder="Filter…"
              className="h-7 w-48 rounded-sm border bg-muted pr-2 pl-7 text-[13px] outline-none placeholder:text-muted-foreground focus:border-primary"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <span className="hidden items-center gap-1.5 font-mono text-[11px] text-muted-foreground xl:flex">
            <Kbd>←</Kbd>
            <Kbd>→</Kbd> move the selected card
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={cn('min-w-0 flex-1 overflow-auto p-6', selected && 'hidden lg:block')}>
          {jobs.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {jobs.error.message}
            </p>
          ) : jobs.isPending ? (
            <p className="text-sm text-muted-foreground">Loading jobs…</p>
          ) : tracked.length === 0 ? (
            <EmptyState title="Nothing tracked yet">
              Save a job or mark it as applied in{' '}
              <Link to="/jobs/matches" className="underline underline-offset-4">
                Jobs
              </Link>{' '}
              and it shows up here.
            </EmptyState>
          ) : (
            <div className="flex items-start gap-4">
              {STAGES.map((stage) => {
                const inColumn = shown.filter((job) => job.status === stage.status)
                const collapsed = stage.status === 'rejected' && !showRejected
                return (
                  <section
                    key={stage.status}
                    aria-label={stage.label}
                    className={cn('shrink-0 rounded-lg border bg-card', collapsed ? 'w-44' : 'w-80')}
                  >
                    <h2 className="flex items-center gap-2 border-b px-4 py-3 text-base font-semibold">
                      <span className={cn('size-2 rounded-full', stage.tone)} aria-hidden />
                      {stage.label}
                      <span className="font-mono text-xs font-normal text-muted-foreground">{inColumn.length}</span>
                      {stage.status === 'rejected' ? (
                        <button
                          type="button"
                          aria-expanded={showRejected}
                          className="ml-auto font-mono text-[11px] font-normal text-muted-foreground underline underline-offset-4"
                          onClick={() => setShowRejected((show) => !show)}
                        >
                          {showRejected ? 'Hide' : 'Show'}
                        </button>
                      ) : null}
                    </h2>
                    {collapsed ? null : (
                      <ul className="space-y-3 p-3">
                        {inColumn.map((job) => (
                          <TrackerCard
                            key={job.id}
                            job={job}
                            selected={job.id === selectedId}
                            onSelect={() => setSelectedId(job.id)}
                          />
                        ))}
                        {inColumn.length === 0 ? (
                          <li className="px-1 py-2 font-mono text-[11px] text-muted-foreground">Empty</li>
                        ) : null}
                      </ul>
                    )}
                  </section>
                )
              })}
            </div>
          )}
        </div>
        {selected ? <Record key={selected.id} job={selected} onClose={() => setSelectedId(null)} /> : null}
      </div>
    </div>
  )
}
