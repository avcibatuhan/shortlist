import { Bookmark, CircleCheck, ExternalLink, EyeOff, Sparkles } from 'lucide-react'
import { Kbd } from '@/components/Kbd'
import { Button } from '@/components/ui/button'

export type JobAction = 'applied' | 'saved' | 'ignored' | 'letter' | 'open'

/** The decisions on the selected job, each with its key. */
export function ActionBar({ onAction }: { onAction: (action: JobAction) => void }) {
  return (
    <div role="toolbar" aria-label="Job actions" className="flex flex-wrap items-center gap-2">
      <Button size="lg" className="px-3.5" aria-keyshortcuts="a" onClick={() => onAction('applied')}>
        <CircleCheck aria-hidden /> Applied <Kbd className="border-black/20 bg-black/20 text-primary-foreground">A</Kbd>
      </Button>
      <Button size="lg" variant="outline" aria-keyshortcuts="s" onClick={() => onAction('saved')}>
        <Bookmark aria-hidden /> Save <Kbd>S</Kbd>
      </Button>
      <Button size="lg" variant="outline" aria-keyshortcuts="i" onClick={() => onAction('ignored')}>
        <EyeOff aria-hidden /> Ignore <Kbd>I</Kbd>
      </Button>
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      <Button size="lg" variant="outline" aria-keyshortcuts="c" onClick={() => onAction('letter')}>
        <Sparkles className="text-primary-soft" aria-hidden /> Cover letter <Kbd>C</Kbd>
      </Button>
      <Button size="lg" variant="outline" aria-keyshortcuts="o" onClick={() => onAction('open')}>
        <ExternalLink aria-hidden /> Open ad <Kbd>O</Kbd>
      </Button>
    </div>
  )
}

/** Label mode: one verdict per job, for the model evaluation. */
export function LabelBar({
  label,
  onLabel,
  onSkip,
}: {
  label: boolean | null
  onLabel: (label: boolean) => void
  onSkip: () => void
}) {
  return (
    <div role="toolbar" aria-label="Label this job" className="flex flex-wrap items-center gap-2">
      <Button
        size="lg"
        variant={label === true ? 'default' : 'outline'}
        className="px-3.5"
        aria-pressed={label === true}
        aria-keyshortcuts="y"
        onClick={() => onLabel(true)}
      >
        Relevant <Kbd>Y</Kbd>
      </Button>
      <Button
        size="lg"
        variant={label === false ? 'default' : 'outline'}
        className="px-3.5"
        aria-pressed={label === false}
        aria-keyshortcuts="n"
        onClick={() => onLabel(false)}
      >
        Not relevant <Kbd>N</Kbd>
      </Button>
      <Button size="lg" variant="ghost" aria-keyshortcuts="j" onClick={onSkip}>
        Skip <Kbd>J</Kbd>
      </Button>
    </div>
  )
}
