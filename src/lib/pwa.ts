import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'

import { anyActive, getGenerationState } from '@/lib/generation/store'

// Chromium's install prompt event; not in the DOM typings
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const isInstallPrompt = (event: Event): event is BeforeInstallPromptEvent =>
  'prompt' in event && typeof event.prompt === 'function'

const standaloneQuery = window.matchMedia('(display-mode: standalone)')

export const isStandalone = () =>
  standaloneQuery.matches ||
  // iOS before display-mode support
  ('standalone' in navigator && navigator.standalone === true)

// The app opened from a phone's Home Screen gets its own navigation (tab bar, no website pitch): one flag on
// <html> that the installed: CSS variant and the tab bar both read. In development a localStorage switch
// (synboxInstalledPreview = 1) turns it on in a browser tab, since no browser emulates display-mode
export const isInstalledPhone = () =>
  (isStandalone() && window.matchMedia('(pointer: coarse)').matches) ||
  (import.meta.env.DEV &&
    localStorage.getItem('synboxInstalledPreview') === '1')
document.documentElement.toggleAttribute('data-installed', isInstalledPhone())

// iPadOS reports itself as a Mac; a touch screen gives it away
const isIos =
  /iPhone|iPad|iPod/u.test(navigator.userAgent) ||
  (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)

// How this browser can install the app: its own prompt (Chromium), Share › Add to Home Screen (iOS
// Safari), already installed, or not at all
export type InstallMethod =
  | { kind: 'prompt'; prompt: () => Promise<void> }
  | { kind: 'ios' }
  | { kind: 'installed' }
  | { kind: 'unavailable' }

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
// Read once per change, so useSyncExternalStore sees a stable snapshot between them
let installMethod: InstallMethod = { kind: 'unavailable' }

const publish = (next: InstallMethod) => {
  installMethod = next
  for (const listener of listeners) {
    listener()
  }
}

const readInstallMethod = (): InstallMethod => {
  if (isStandalone()) {
    return { kind: 'installed' }
  }
  const event = deferredPrompt
  if (event) {
    const prompt = async () => {
      // A prompt can be shown once; Chromium fires a fresh event if it is dismissed
      deferredPrompt = null
      publish(readInstallMethod())
      await event.prompt()
    }
    return { kind: 'prompt', prompt }
  }
  return isIos ? { kind: 'ios' } : { kind: 'unavailable' }
}
installMethod = readInstallMethod()

const refresh = () => {
  publish(readInstallMethod())
}

// Chromium fires this early, often before React mounts, so it is caught at module load
window.addEventListener('beforeinstallprompt', (event) => {
  if (isInstallPrompt(event)) {
    event.preventDefault()
    deferredPrompt = event
    refresh()
  }
})
window.addEventListener('appinstalled', () => {
  deferredPrompt = null
  refresh()
})
standaloneQuery.addEventListener('change', refresh)

const subscribeInstall = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useInstallMethod = () =>
  useSyncExternalStore(subscribeInstall, () => installMethod)

const subscribeOnline = (listener: () => void) => {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

export const useOnline = () =>
  useSyncExternalStore(subscribeOnline, () => navigator.onLine)

// Updates swap in without asking (below), so the first load on a new version says so once, whichever way it
// arrived: a page change, a reopen or a reload (AppNotices shows it). The build last seen is kept per browser; a
// first visit and a development build say nothing
const LAST_BUILD_KEY = 'synboxLastBuild'
const isNewBuild = () => {
  try {
    const previous = localStorage.getItem(LAST_BUILD_KEY)
    localStorage.setItem(LAST_BUILD_KEY, __BUILD_ID__)
    return (
      previous !== null && previous !== __BUILD_ID__ && __BUILD_ID__ !== 'local'
    )
  } catch {
    // Storage blocked (a private window): no note
    return false
  }
}
export const appJustUpdated = isNewBuild()

// A page from one deploy asks for a part it hasn't loaded yet (a route opened for the first time) after a later
// deploy deleted it. Loading the page again gets the current deploy. Once a minute at most, so a part that is
// really missing shows its error instead of reloading forever
const CHUNK_RELOAD_KEY = 'synboxChunkReload'
const CHUNK_RELOAD_MS = 60 * 1000
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0)
    if (Date.now() - last < CHUNK_RELOAD_MS) {
      return
    }
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
  } catch {
    return
  }
  event.preventDefault()
  window.location.reload()
})

// Earlier workers kept pages in this cache; nothing reads it any more
if ('caches' in window) {
  void caches.delete('pages')
}

// A new deploy is downloaded in the background and waits. It is swapped in only by the next in-app page
// change, which then loads the new page from the server as one ordinary page load. Never by reloading a page
// that is already showing: that redraws it in front of the viewer and can cut off what they just did (a play
// press, a click). A tab that stays on one page keeps its version until it changes page or is reopened
const UPDATE_CHECK_MS = 60 * 60 * 1000
// The new version normally activates in well under a second; past this the page loads anyway
const ACTIVATE_TIMEOUT_MS = 3000

let updateReady = false
let swapping = false

// A load would cut a running generation's progress off
const isGenerating = () => anyActive(getGenerationState())

// Activates the waiting version, then loads `href` on it. The plugin reloads on a controller change instead,
// which never comes for a page the old worker did not control (a hard reload while another tab is open)
const loadOnNewVersion = async (href: string) => {
  swapping = true
  let loaded = false
  const load = () => {
    if (!loaded) {
      loaded = true
      window.location.assign(href)
    }
  }
  setTimeout(load, ACTIVATE_TIMEOUT_MS)
  // Asked here: a version already waiting at load reports itself before onRegisteredSW runs
  const registration = await navigator.serviceWorker.getRegistration()
  const waiting = registration?.waiting
  if (!waiting) {
    // Another tab activated it already
    load()
    return
  }
  waiting.addEventListener('statechange', () => {
    if (waiting.state === 'activated' || waiting.state === 'redundant') {
      load()
    }
  })
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's postMessage takes no origin
  waiting.postMessage({ type: 'SKIP_WAITING' })
}

// Someone moving around the lyrics pages is reading, maybe with no connection: a reload there would cut into
// that. The new version waits until they leave them, and until the phone is online
const LYRICS_PATH = /^\/lyrics(?:\/|$)/u
const readingLyrics = (target: URL) =>
  LYRICS_PATH.test(window.location.pathname) ||
  LYRICS_PATH.test(target.pathname)

// React Router moves between pages with history.pushState. With a version waiting, that page change becomes a
// full load of the same address on the new version instead. Replacements (tidying the current address) and
// the back button stay in-app
const pushState = window.history.pushState.bind(window.history)
window.history.pushState = (
  data: unknown,
  unused: string,
  url?: string | URL | null
) => {
  if (
    updateReady &&
    !swapping &&
    !isGenerating() &&
    url !== undefined &&
    url !== null
  ) {
    const target = new URL(url, window.location.href)
    if (
      target.origin === window.location.origin &&
      navigator.onLine &&
      !readingLyrics(target)
    ) {
      void loadOnNewVersion(target.href)
      return
    }
  }
  pushState(data, unused, url)
}

registerSW({
  onNeedRefresh: () => {
    updateReady = true
  },
  onNeedReload: () => {
    // loadOnNewVersion loads the page once the new version is active
  },
  onRegisteredSW: (_url, registration) => {
    if (!registration) {
      return
    }
    // update() rejects with "newestWorker is null" when the browser has dropped the registration's worker
    // (iOS clears it for storage), and offline. Neither is news: the page loads from the network then, and
    // the next check tries again
    const check = async () => {
      if (
        registration.installing ??
        registration.waiting ??
        registration.active
      ) {
        try {
          await registration.update()
        } catch {
          // Checked again within the hour and on the next return
        }
      }
    }
    // An installed app is resumed rather than reloaded, so check whenever it comes back too
    setInterval(() => {
      void check()
    }, UPDATE_CHECK_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void check()
      }
    })
  },
})
