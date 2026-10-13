import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

// Must match the inline script in index.html that applies the theme before first paint.
const STORAGE_KEY = 'shortlist-theme'

function initialTheme(): Theme {
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'light') return 'light'
  } catch {
    // Storage unavailable: use the default.
  }
  // Dark is the design's primary canvas; light only when chosen with the toggle.
  return 'dark'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Not persisted; the choice still applies for this visit.
    }
  }, [theme])

  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }
}
