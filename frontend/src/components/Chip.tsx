import { ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Job, JobSource } from '@/api/client'
import { SOURCE_LABELS } from '@/lib/sources'
import { cn } from '@/lib/utils'
import { VERDICT_LABELS, VERDICT_TONES, verdictOf, type Tone } from '@/lib/verdict'

const TONES: Record<Tone, string> = {
  neutral: 'border-border bg-surface-highest/60 text-muted-foreground',
  match: 'border-match/30 bg-match/12 text-match',
  warn: 'border-warn/30 bg-warn/12 text-warn',
  primary: 'border-primary/30 bg-primary/15 text-primary-soft',
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
}

/** Compact data chip: 4px corners, mono type. Colour never stands alone — always with a word. */
export function Chip({
  tone = 'neutral',
  dot = false,
  className,
  children,
}: {
  tone?: Tone
  dot?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[11px] leading-[14px] font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  )
}

export function VerdictChip({ job }: { job: Job }) {
  const verdict = verdictOf(job)
  return (
    <Chip tone={VERDICT_TONES[verdict]} dot>
      {VERDICT_LABELS[verdict]}
    </Chip>
  )
}

/** Link to the posting on its job board. */
export function SourceLink({ source, className }: { source: JobSource; className?: string }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border bg-muted px-3 font-mono text-xs font-medium transition-colors hover:bg-surface-high',
        className,
      )}
    >
      {SOURCE_LABELS[source.source]}
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  )
}
