import { formatPercent, formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'

/** This month's estimated spend against the monthly budget. */
export function BudgetMeter({ spent, budget, className }: { spent: number; budget: number; className?: string }) {
  const share = budget > 0 ? Math.min(1, spent / budget) : 1
  const over = spent > budget
  return (
    <div className={cn('space-y-1.5', className)}>
      <div
        role="meter"
        aria-label="Budget used this month"
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={spent}
        aria-valuetext={`${formatUsd(spent)} of ${formatUsd(budget)}`}
        className="h-1.5 overflow-hidden rounded-full bg-surface-highest"
      >
        <div
          className={cn('h-full rounded-full', over ? 'bg-warn' : 'bg-match')}
          style={{ width: `${Math.max(share * 100, spent > 0 ? 1.5 : 0)}%` }}
        />
      </div>
      <p className="flex justify-between gap-3 font-mono text-[11px] text-muted-foreground">
        <span>
          {formatUsd(spent)} of {formatUsd(budget)} this month
        </span>
        <span className={over ? 'text-warn' : 'text-match'}>{formatPercent(spent, budget)} used</span>
      </p>
    </div>
  )
}
