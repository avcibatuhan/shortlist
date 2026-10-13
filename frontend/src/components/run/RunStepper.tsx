import { Check, CircleAlert, Loader2 } from 'lucide-react'
import type { RunProgress, SourceName, SourceProgress } from '@/api/client'
import { SOURCE_LABELS } from '@/lib/sources'
import { cn } from '@/lib/utils'

type Stage = RunProgress['stage']
const STAGES: Stage[] = ['fetching', 'deduplicating', 'matching', 'done']

function stageLabel(stage: Stage, progress: RunProgress | null): string {
  switch (stage) {
    case 'fetching':
      return 'Fetch'
    case 'deduplicating':
      return 'Deduplicate'
    case 'matching':
      return progress?.stage === 'matching' ? `LLM ${progress.llm_done} / ${progress.llm_total}` : 'LLM'
    default:
      return 'Done'
  }
}

function sourceText(source: SourceProgress): string {
  switch (source.state) {
    case 'pending':
      return 'Waiting'
    case 'fetching':
      return 'Fetching…'
    case 'normalizing':
      return `Normalizing ${source.fetched} results…`
    case 'done':
      return `Done · ${source.fetched} fetched`
    case 'error':
      return 'Error'
  }
}

function SourceIcon({ state }: { state: SourceProgress['state'] }) {
  if (state === 'done') return <Check className="size-4 text-match" aria-hidden />
  if (state === 'error') return <CircleAlert className="size-4 text-destructive" aria-hidden />
  if (state === 'pending') return <span className="size-4" aria-hidden />
  return <Loader2 className="size-4 animate-spin text-primary-soft" aria-hidden />
}

/** Live progress of the active run: the stages, each source's row, and the LLM count. */
export function RunStepper({ sources, progress }: { sources: string[]; progress: RunProgress | null }) {
  const stage = progress?.stage ?? 'fetching'
  const stageIndex = STAGES.indexOf(stage === 'failed' ? 'done' : stage)
  const llmShare =
    progress?.stage === 'matching' && progress.llm_total > 0 ? progress.llm_done / progress.llm_total : null
  return (
    <section aria-label="Run progress" role="status" className="space-y-4">
      <ol className="flex flex-wrap items-center gap-2 font-mono text-xs">
        {STAGES.map((name, index) => (
          <li
            key={name}
            aria-current={index === stageIndex ? 'step' : undefined}
            className={cn(
              'rounded-sm border px-2.5 py-1',
              index === stageIndex
                ? 'border-primary bg-primary text-primary-foreground'
                : index < stageIndex
                  ? 'border-match/30 bg-match/10 text-match'
                  : 'text-muted-foreground',
            )}
          >
            {stageLabel(name, progress)}
          </li>
        ))}
      </ol>
      {llmShare !== null ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-highest" aria-hidden>
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${llmShare * 100}%` }} />
        </div>
      ) : null}
      <ul className="space-y-2">
        {sources.map((name) => {
          const source = progress?.sources[name] ?? { state: 'pending', fetched: 0 }
          return (
            <li key={name} className="text-sm">
              <div className="flex items-center gap-2">
                <SourceIcon state={source.state} />
                <span className="w-24 font-medium">{SOURCE_LABELS[name as SourceName] ?? name}</span>
                <span className="font-mono text-xs text-muted-foreground">{sourceText(source)}</span>
              </div>
              {source.error ? <p className="mt-1 pl-6 text-xs text-destructive">{source.error}</p> : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
