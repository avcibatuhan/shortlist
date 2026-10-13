import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A level-1 surface: 10px corners, hairline border. */
export function Panel({
  label,
  className,
  children,
}: {
  /** Accessible name; makes the panel a landmark region. */
  label?: string
  className?: string
  children: ReactNode
}) {
  return (
    <section aria-label={label} className={cn('rounded-lg border bg-card p-5', className)}>
      {children}
    </section>
  )
}

/** Scrolling page body for pages that are not split into panes. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={cn('mx-auto max-w-[1280px] space-y-6 p-6', className)}>{children}</div>
    </div>
  )
}
