import { atom, useAtom, useAtomValue } from 'jotai'
import { useEffect, useLayoutEffect, useRef } from 'react'

import { LANDSCAPE_FLIP_ATTR, LANDSCAPE_LOCK_ATTR } from '@/lib/page-turn'
import { transitionLayout } from '@/lib/view-transition'

// 'native': the browser holds the orientation (Android: only while the page is fullscreen). 'turned': no
// orientation lock (iPhone), so the page turns itself on its side whenever the screen stands upright
type LandscapeLock = 'off' | 'native' | 'turned'

// For this visit only: from one song to the next, not to the next time the app opens
const landscapeLockAtom = atom<LandscapeLock>('off')
// A turned page the other way round, top to the screen's left, for a phone held top to the right: the system
// won't turn it while its rotation lock holds the screen upright
const landscapeFlipAtom = atom(false)

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

// The page turns only while the screen stands upright (see globals.css): on a phone already on its side the lock
// changes nothing on screen, so nothing turns
const turn = (
  kind: 'turn-in' | 'turn-out' | 'turn-back' | 'flip',
  update: () => void
) => {
  if (matchMedia('(orientation: portrait)').matches) {
    transitionLayout(kind, update)
  } else {
    update()
  }
}

// Mounted with the player: a page elsewhere in the app is never turned
export const useLandscapeLock = () => {
  const [mode, setMode] = useAtom(landscapeLockAtom)
  const [flipped, setFlipped] = useAtom(landscapeFlipAtom)
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

  // Before paint, so a turn's view transition snapshots the page already turned
  useLayoutEffect(() => {
    const root = document.documentElement
    root.toggleAttribute(LANDSCAPE_LOCK_ATTR, mode === 'turned')
    root.toggleAttribute(LANDSCAPE_FLIP_ATTR, mode === 'turned' && flipped)
    return () => {
      root.removeAttribute(LANDSCAPE_LOCK_ATTR)
      root.removeAttribute(LANDSCAPE_FLIP_ATTR)
    }
  }, [mode, flipped])

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
      turn(flipped ? 'turn-back' : 'turn-out', () => {
        setMode('off')
        setFlipped(false)
      })
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
    turn('turn-in', () => {
      setMode('turned')
    })
  }

  const flip = () => {
    turn('flip', () => {
      setFlipped(!flipped)
    })
  }

  return { flip, locked: mode !== 'off', toggle, turned: mode === 'turned' }
}
