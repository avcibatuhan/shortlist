import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A key hint. Decorative next to a button; the key itself is announced via aria-keyshortcuts. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-sm border bg-surface-highest/70 px-1 py-0.5 font-mono text-[10px] leading-none text-muted-foreground',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
