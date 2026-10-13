import { User } from 'lucide-react'
import type { Job } from '@/api/client'
import { Chip, VerdictChip } from '@/components/Chip'
import { formatRelativeDay } from '@/lib/format'
import { REMOTE_LABELS } from '@/lib/jobs'
import { SOURCE_LABELS } from '@/lib/sources'
import { cn } from '@/lib/utils'

/** One job in the feed: title, company · city, verdict and a line of facts. */
export function JobListRow({
  job,
  selected,
  onSelect,
}: {
  job: Job
  selected: boolean
  onSelect: () => void
}) {
  const facts = [job.company, job.location].filter(Boolean).join(' · ')
  const sources = [...new Set(job.sources.map((source) => SOURCE_LABELS[source.source]))]
  return (
    <li data-job-id={job.id}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected || undefined}
        className={cn(
          'group w-full border-b border-l-[3px] p-3.5 text-left transition-colors duration-100',
          selected ? 'border-l-primary bg-surface-high' : 'border-l-transparent hover:bg-muted',
        )}
      >
        <span className="mb-1 flex items-start justify-between gap-2">
          <span
            className={cn(
              'text-sm leading-snug group-hover:text-primary-soft',
              selected ? 'font-semibold' : 'font-medium',
            )}
          >
            {job.title}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {job.owner_label !== null ? (
              <User className="size-3.5 text-primary-soft" aria-label="Your verdict" />
            ) : null}
            <VerdictChip job={job} />
          </span>
        </span>
        {facts ? <span className="mb-2 block text-xs text-muted-foreground">{facts}</span> : null}
        <span className="flex flex-wrap items-center gap-1.5">
          {job.remote !== 'unknown' ? <Chip>{REMOTE_LABELS[job.remote]}</Chip> : null}
          {job.salary_text ? <Chip tone="match">{job.salary_text}</Chip> : null}
          {sources.map((source) => (
            <Chip key={source}>{source}</Chip>
          ))}
          {job.posted_at ? (
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {formatRelativeDay(job.posted_at)}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  )
}
