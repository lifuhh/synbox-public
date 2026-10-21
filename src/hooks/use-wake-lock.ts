import { useEffect } from 'react'

// Keeps the screen on while `active`. The browser drops the lock whenever the page is hidden, so it is taken
// again each time the page comes back
export const useWakeLock = (active: boolean) => {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    let released = false
    const request = async () => {
      if (document.visibilityState !== 'visible' || lock?.released === false) {
        return
      }
      try {
        const sentinel = await navigator.wakeLock?.request('screen')
        if (released) {
          await sentinel?.release()
        } else {
          lock = sentinel ?? null
        }
      } catch {
        // Not allowed (battery saver, an older browser): the screen may dim
      }
    }
    const handleVisibility = () => {
      void request()
    }
    const hold = () => {
      void request()
      document.addEventListener('visibilitychange', handleVisibility)
      return () => {
        released = true
        document.removeEventListener('visibilitychange', handleVisibility)
        void lock?.release()
      }
    }
    return active ? hold() : undefined
  }, [active])
}
