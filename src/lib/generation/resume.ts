// The moments a page gets its network back: shown again after the app was switched away, restored from the
// back/forward cache, thawed after the browser froze it, or back online. A connection that was open before
// one of these is likely dead without knowing it, so the generation streams reconnect at once instead of
// waiting for their idle timeout. iOS can suspend a page without telling it it was hidden; a clock that
// jumped between two of our own ticks gives that away.

const TICK_MS = 1000
const GAP_MS = 5000

const listeners = new Set<() => void>()
let stop: (() => void) | null = null

const fire = () => {
  for (const listener of listeners) {
    listener()
  }
}

const start = () => {
  let hidden = document.visibilityState === 'hidden'
  let last = Date.now()
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      hidden = true
    } else if (hidden) {
      hidden = false
      fire()
    }
  }
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      fire()
    }
  }
  // A hidden page's timers are throttled, which is not a suspension: only a gap seen on screen counts
  const timer = setInterval(() => {
    const now = Date.now()
    if (now - last > GAP_MS && document.visibilityState === 'visible') {
      fire()
    }
    last = now
  }, TICK_MS)
  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('resume', fire)
  if ('addEventListener' in globalThis) {
    globalThis.addEventListener('pageshow', onPageShow)
    globalThis.addEventListener('online', fire)
  }
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisibility)
    document.removeEventListener('resume', fire)
    if ('removeEventListener' in globalThis) {
      globalThis.removeEventListener('pageshow', onPageShow)
      globalThis.removeEventListener('online', fire)
    }
  }
}

// Calls `listener` at each of those moments until the returned function is called
export const onResume = (listener: () => void) => {
  listeners.add(listener)
  stop ??= start()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stop?.()
      stop = null
    }
  }
}
