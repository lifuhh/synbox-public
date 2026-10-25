import { isStandalone } from '@/lib/pwa'
import { deviceId } from '@/lib/song-stats'

// Usage events for the app's owner (the auth Worker's worker/src/events.ts holds the list and checks every one):
// which parts of the app get used. Kept in memory and sent together every FLUSH_MS, or when the page is hidden,
// so a press costs an array push and nothing else. Never sent when the browser asks not to be tracked (Do Not
// Track, Global Privacy Control), and nothing waits on them: one that doesn't arrive is simply not counted
export type UsageEvent =
  | {
      name: 'app_open'
      props: {
        surface: 'installed' | 'web'
        device: 'phone' | 'tablet' | 'desktop'
      }
    }
  | { name: 'song_open'; videoId: string }
  | {
      name: 'lyrics_feature'
      props: {
        feature: 'lyrics' | 'romaji' | 'translation' | 'language'
        on: 'true' | 'false'
      }
    }
  | { name: 'share'; props: { method: 'sheet' | 'copy' } }
  | { name: 'install_prompt'; props: { method: 'prompt' | 'guide' } }
  | { name: 'installed' }

const FLUSH_MS = 15_000
// The Worker takes at most 50 a request; past this many waiting, older ones are dropped
const MAX_WAITING = 50

const optedOut = () => {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1'
}

let waiting: (UsageEvent & { at: number })[] = []
let timer = 0

const body = () => JSON.stringify({ device: deviceId(), events: waiting })

const post = async (payload: string) => {
  try {
    await fetch('/api/events', {
      body: payload,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      method: 'POST',
    })
  } catch {
    // Not counted, nothing else
  }
}

const flush = (leaving: boolean) => {
  window.clearTimeout(timer)
  timer = 0
  if (waiting.length === 0) {
    return
  }
  const payload = body()
  waiting = []
  try {
    // Leaving, only a beacon is sure to go; it carries the session cookie on this origin
    if (
      leaving &&
      navigator.sendBeacon(
        `/api/events`,
        new Blob([payload], { type: 'application/json' })
      )
    ) {
      return
    }
    void post(payload)
  } catch {
    // Not counted, nothing else
  }
}

let listening = false
const listen = () => {
  if (listening) {
    return
  }
  listening = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flush(true)
    }
  })
}

export const track = (event: UsageEvent) => {
  try {
    if (optedOut()) {
      return
    }
    listen()
    waiting = [
      ...waiting.slice(-(MAX_WAITING - 1)),
      { ...event, at: Date.now() },
    ]
    if (timer === 0) {
      timer = window.setTimeout(() => {
        flush(false)
      }, FLUSH_MS)
    }
  } catch {
    // Not counted, nothing else
  }
}

// A lyrics toggle pressed: what it now shows ('language' on is English, off Chinese)
export const trackLyricsFeature = (
  feature: 'lyrics' | 'romaji' | 'translation' | 'language',
  on: boolean
) => {
  track({
    name: 'lyrics_feature',
    props: { feature, on: on ? 'true' : 'false' },
  })
}

// Once per page load: how the app was opened
export const trackAppOpen = () => {
  const installed = isStandalone()
  const coarse = matchMedia('(pointer: coarse)').matches
  const short = Math.min(screen.width, screen.height)
  let device: 'phone' | 'tablet' | 'desktop' = 'desktop'
  if (coarse) {
    device = short < 600 ? 'phone' : 'tablet'
  }
  track({
    name: 'app_open',
    props: { device, surface: installed ? 'installed' : 'web' },
  })
}
