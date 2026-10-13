import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Kbd } from '@/components/Kbd'
import { Button } from '@/components/ui/button'
import { useShortcuts } from '@/lib/shortcuts'
import { ToastContext, UNDO_MS } from '@/lib/toast'

type Toast = { id: number; message: string; undo?: () => void }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const nextId = useRef(1)

  const show = useCallback((message: string, undo?: () => void) => {
    setToast({ id: nextId.current++, message, undo })
  }, [])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), UNDO_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  const runUndo = () => {
    if (!toast?.undo) return
    toast.undo()
    setToast(null)
  }
  useShortcuts({ u: runUndo })

  const api = useMemo(() => ({ show }), [show])
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-6 bottom-20 z-50 flex justify-end">
        {toast ? (
          <div
            role="status"
            className="pointer-events-auto flex items-center gap-3 rounded-lg border bg-popover px-4 py-2.5 text-sm shadow-[0_8px_24px_-4px_rgb(0_0_0/0.6)]"
          >
            <span>{toast.message}</span>
            {toast.undo ? (
              <Button size="sm" variant="outline" onClick={runUndo} aria-keyshortcuts="u">
                Undo <Kbd>U</Kbd>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  )
}
