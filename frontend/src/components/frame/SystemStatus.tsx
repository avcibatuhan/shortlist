import { Bot, Database, Server } from 'lucide-react'
import type { ReactNode } from 'react'
import { useHealth, useModels } from '@/api/hooks'
import { cn } from '@/lib/utils'

type State = 'ok' | 'error' | 'pending'

const DOT: Record<State, string> = {
  ok: 'bg-match',
  error: 'bg-destructive',
  pending: 'bg-muted-foreground/40',
}

function Row({
  icon,
  label,
  state,
  value,
  detail,
}: {
  icon: ReactNode
  label: string
  state: State
  value: string
  detail?: string | null
}) {
  return (
    <li title={detail ?? undefined} className="rounded-sm bg-surface-lowest/60 px-2 py-1">
      <div className="flex items-center gap-2">
        <span className={cn(state === 'ok' ? 'text-match' : 'text-muted-foreground')} aria-hidden>
          {icon}
        </span>
        <span>{label}</span>
        <span
          className={cn(
            'ml-auto truncate',
            state === 'ok' ? 'text-match' : state === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {value}
        </span>
        <span className={cn('size-1.5 shrink-0 rounded-full', DOT[state])} aria-hidden />
      </div>
      {state === 'error' && detail ? <p className="mt-1 text-[11px] text-destructive">{detail}</p> : null}
    </li>
  )
}

/** Backend, database and Ollama at a glance; a problem shows what to do about it. */
export function SystemStatus() {
  const health = useHealth()
  const models = useModels()

  const backend: State = health.isPending ? 'pending' : health.isError ? 'error' : 'ok'
  const database: State =
    health.data === undefined ? 'pending' : health.data.database === 'ok' ? 'ok' : 'error'
  const modelMissing =
    models.data !== undefined && !models.data.error && !models.data.installed.includes(models.data.current)
  const ollama: State =
    models.data === undefined ? 'pending' : models.data.error || modelMissing ? 'error' : 'ok'

  return (
    <section aria-label="System status" className="border-t pt-3">
      <h2 className="label-mono mb-2 px-1">System</h2>
      <ul className="space-y-1.5 font-mono text-xs text-muted-foreground">
        <Row
          icon={<Server className="size-3.5" />}
          label="Backend"
          state={backend}
          value={backend === 'ok' ? `OK · ${health.data?.latencyMs} ms` : backend === 'error' ? 'Unreachable' : '…'}
          detail={backend === 'error' ? 'Start it with `make start`.' : null}
        />
        <Row
          icon={<Database className="size-3.5" />}
          label="Database"
          state={health.isError ? 'pending' : database}
          value={health.isError ? 'Unknown' : database === 'ok' ? 'OK' : database === 'error' ? 'Error' : '…'}
          detail={health.data?.detail}
        />
        <Row
          icon={<Bot className="size-3.5" />}
          label="Ollama"
          state={ollama}
          value={
            ollama === 'pending'
              ? '…'
              : models.data?.error
                ? 'Unreachable'
                : modelMissing
                  ? 'Model missing'
                  : (models.data?.current ?? '')
          }
          detail={
            models.data?.error ??
            (modelMissing ? `Run: ollama pull ${models.data?.current}` : `${models.data?.current} is installed`)
          }
        />
      </ul>
    </section>
  )
}
