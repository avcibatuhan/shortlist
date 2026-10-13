import { useEffect, useRef } from 'react'

/**
 * Single-key shortcuts for a page. Ignored while typing in a field, with a modifier key
 * held, or while a dialog is open.
 */
export function useShortcuts(handlers: Record<string, () => void>) {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return
      const target = event.target
      if (target instanceof HTMLElement) {
        if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
        if (target.closest('[role="dialog"], [role="alertdialog"]')) return
      }
      // Letters match in either case; other keys by their name ("?", "/", "ArrowLeft", " ").
      const handler = latest.current[event.key.length === 1 ? event.key.toLowerCase() : event.key]
      if (handler) {
        event.preventDefault()
        handler()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
