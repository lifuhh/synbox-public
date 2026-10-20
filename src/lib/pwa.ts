import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'

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

// A new deploy is downloaded in the background and waits. Closing the app applies it on the next
// launch; while the app stays open, the top bar's update button applies it in place
const UPDATE_CHECK_MS = 60 * 60 * 1000

let updateReady = false
const updateListeners = new Set<() => void>()

const applyServiceWorker = registerSW({
  onNeedRefresh: () => {
    updateReady = true
    for (const listener of updateListeners) {
      listener()
    }
  },
  onRegisteredSW: (_url, registration) => {
    if (!registration) {
      return
    }
    const check = () => {
      void registration.update()
    }
    // An installed app is resumed rather than reloaded, so check whenever it comes back too
    setInterval(check, UPDATE_CHECK_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        check()
      }
    })
  },
})

const subscribeUpdate = (listener: () => void) => {
  updateListeners.add(listener)
  return () => {
    updateListeners.delete(listener)
  }
}

export const useUpdateReady = () =>
  useSyncExternalStore(subscribeUpdate, () => updateReady)

// Activates the waiting version and reloads the page the viewer is on
export const applyUpdate = async () => {
  await applyServiceWorker(true)
}
