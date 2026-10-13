import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'

// jsdom has no ResizeObserver; Radix components (Switch) observe their size.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
