import { createContext, useContext } from 'react'

export const UNDO_MS = 8000

export type ToastApi = { show: (message: string, undo?: () => void) => void }

export const ToastContext = createContext<ToastApi>({ show: () => {} })

/** `show(message, undo)`: one toast at a time, bottom right; with undo it stays 8 seconds. */
export function useToast(): ToastApi {
  return useContext(ToastContext)
}
