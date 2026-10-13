import { Bot } from 'lucide-react'
import { useChooseModel, useModels } from '@/api/hooks'

/** Choose the LLM from the models installed in Ollama. Applies to the next decision or letter. */
export function ModelPicker() {
  const models = useModels()
  const choose = useChooseModel()

  if (!models.data) return null
  const { current, installed, error } = models.data
  // Show a pending choice at once; fall back to the saved model if saving fails.
  const selected = choose.isPending && choose.variables ? choose.variables : current
  const options = installed.includes(selected) ? installed : [selected, ...installed]
  const problem = choose.error?.message

  return (
    <div className="flex items-center gap-2">
      {problem ? (
        <span role="alert" className="max-w-64 truncate text-xs text-destructive" title={problem}>
          {problem}
        </span>
      ) : null}
      <label className="flex h-8 items-center gap-1.5 rounded-md border bg-muted pr-1 pl-2.5 font-mono text-xs transition-colors hover:bg-surface-high">
        <Bot className="size-4 text-primary-soft" aria-hidden />
        <span className="sr-only">Model</span>
        <select
          className="h-full max-w-56 cursor-pointer bg-transparent pr-1 font-mono text-xs font-medium outline-none"
          value={selected}
          disabled={choose.isPending}
          onChange={(event) => choose.mutate(event.target.value)}
        >
          {options.map((name) => (
            <option key={name} value={name} className="bg-popover text-popover-foreground">
              {installed.includes(name) || error ? name : `${name} (not installed)`}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
