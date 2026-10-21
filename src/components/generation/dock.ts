import { useSyncExternalStore } from 'react'

// The top bar's slot for the minimized generation on a phone. The top bar registers it through a callback
// ref, and the generation host renders into it once it exists
let dock: HTMLElement | null = null
const listeners = new Set<() => void>()

export const setGenerationDock = (element: HTMLElement | null) => {
  dock = element
  for (const listener of listeners) {
    listener()
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useGenerationDock = () =>
  useSyncExternalStore(subscribe, () => dock)
