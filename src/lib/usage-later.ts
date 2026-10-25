import type { UsageEvent } from './usage'

// A usage event (lib/usage.ts) from code on the first load: the module comes on first use, so the first load
// doesn't carry it, and a module that fails to load just means the event isn't counted
const loadUsage = async () => {
  try {
    return await import('./usage')
  } catch {
    return null
  }
}

export const trackLater = (event: UsageEvent) => {
  void (async () => {
    const usage = await loadUsage()
    usage?.track(event)
  })()
}

export const trackAppOpenLater = () => {
  void (async () => {
    const usage = await loadUsage()
    usage?.trackAppOpen()
  })()
}
