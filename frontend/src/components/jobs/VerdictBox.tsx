import { Check, CircleHelp, Filter, Minus, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Job } from '@/api/client'
import { Kbd } from '@/components/Kbd'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { VERDICT_LABELS, verdictOf, type Verdict } from '@/lib/verdict'

const STYLE: Record<Verdict, { box: string; text: string; icon: ReactNode }> = {
  match: { box: 'border-match/30 bg-match/10', text: 'text-match', icon: <Check className="size-4" /> },
  no_match: { box: 'border-border bg-muted', text: 'text-muted-foreground', icon: <Minus className="size-4" /> },
  undecided: { box: 'border-warn/30 bg-warn/10', text: 'text-warn', icon: <CircleHelp className="size-4" /> },
  filtered: { box: 'border-border bg-muted', text: 'text-muted-foreground', icon: <Filter className="size-4" /> },
}

type Props = {
  job: Job
  /** Set or clear the owner's verdict; absent when the job cannot be changed here. */
  onVerdict?: (label: boolean | null) => void
  /** Ask the LLM again (undecided jobs). */
  onReevaluate?: () => void
  reevaluating?: boolean
}

/** The verdict on a job, why, and the way to overrule it. */
export function VerdictBox({ job, onVerdict, onReevaluate, reevaluating = false }: Props) {
  const verdict = verdictOf(job)
  const style = STYLE[verdict]
  const byOwner = job.owner_label !== null
  const reason =
    verdict === 'filtered'
      ? `${job.filter_reason}. It was not sent to the LLM.`
      : (job.match_reason ?? 'The LLM has not looked at this job yet.')
  const llmSaid = job.match === true ? 'match' : job.match === false ? 'no match' : 'undecided'

  return (
    <section
      aria-label="Verdict"
      className={cn('flex items-center justify-between gap-4 rounded-lg border p-3.5', style.box)}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border', style.box, style.text)}
          aria-hidden
        >
          {style.icon}
        </span>
        <div className="space-y-0.5">
          <p className={cn('flex flex-wrap items-center gap-x-2 text-base font-semibold', style.text)}>
            {VERDICT_LABELS[verdict]}
            <span className="font-mono text-[11px] font-normal text-muted-foreground">
              · {byOwner ? `your verdict (LLM: ${llmSaid})` : verdict === 'filtered' ? 'prefilter' : 'LLM'}
            </span>
          </p>
          <p className="max-w-[90ch] text-[13px] leading-relaxed">{reason}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {onVerdict ? (
          <Button
            variant="outline"
            size="sm"
            aria-keyshortcuts="n"
            onClick={() => onVerdict(verdict !== 'match')}
          >
            {verdict === 'match' ? 'Not a match' : 'Move to matches'} <Kbd>N</Kbd>
          </Button>
        ) : null}
        {onVerdict && byOwner ? (
          <button
            type="button"
            className="font-mono text-[11px] text-muted-foreground underline underline-offset-4 hover:text-foreground"
            onClick={() => onVerdict(null)}
          >
            Clear my verdict
          </button>
        ) : null}
        {verdict === 'undecided' && onReevaluate ? (
          <Button variant="outline" size="sm" disabled={reevaluating} onClick={onReevaluate}>
            <RefreshCw className={reevaluating ? 'animate-spin' : undefined} aria-hidden />
            Re-evaluate undecided
          </Button>
        ) : null}
      </div>
    </section>
  )
}
