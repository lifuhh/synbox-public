import { atom, useAtom, useAtomValue } from 'jotai'
import { useEffect, useRef } from 'react'

import { LANDSCAPE_LOCK_ATTR } from '@/lib/page-turn'

// 'native': the browser holds the orientation (Android: only while the page is fullscreen). 'turned': no
// orientation lock (iPhone), so the page turns itself on its side whenever the screen stands upright
type LandscapeLock = 'off' | 'native' | 'turned'

// For this visit only: from one song to the next, not to the next time the app opens
const landscapeLockAtom = atom<LandscapeLock>('off')

export const usePageTurned = () => useAtomValue(landscapeLockAtom) === 'turned'

const lockNatively = async () => {
  const enter = document.fullscreenEnabled && !document.fullscreenElement
  if (enter) {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
  }
  try {
    await screen.orientation.lock('landscape')
  } catch (error) {
    if (enter) {
      await document.exitFullscreen()
    }
    throw error
  }
  return enter
}

// Mounted with the player: a page elsewhere in the app is never turned
export const useLandscapeLock = () => {
  const [mode, setMode] = useAtom(landscapeLockAtom)
  // Fullscreen entered for the lock ends with it
  const enteredFullscreenRef = useRef(false)

  // The browser lets go of the orientation when fullscreen ends, whatever ended it
  useEffect(() => {
    const sync = () => {
      if (!document.fullscreenElement) {
        setMode((current) => (current === 'native' ? 'off' : current))
      }
    }
    sync()
    document.addEventListener('fullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
    }
  }, [setMode])

  useEffect(() => {
    const root = document.documentElement
    root.toggleAttribute(LANDSCAPE_LOCK_ATTR, mode === 'turned')
    return () => {
      root.removeAttribute(LANDSCAPE_LOCK_ATTR)
    }
  }, [mode])

  const toggle = async () => {
    if (mode === 'native') {
      screen.orientation.unlock()
      if (enteredFullscreenRef.current && document.fullscreenElement) {
        await document.exitFullscreen()
      }
      setMode('off')
      return
    }
    if (mode === 'turned') {
      setMode('off')
      return
    }
    // Fullscreen needs the tap that asked for it, so this runs straight from the click
    if (typeof screen.orientation?.lock === 'function') {
      try {
        enteredFullscreenRef.current = await lockNatively()
        setMode('native')
        return
      } catch {
        // No lock here (iPad Safari, a browser that refuses it): turn the page instead
      }
    }
    setMode('turned')
  }

  return { locked: mode !== 'off', toggle }
}
