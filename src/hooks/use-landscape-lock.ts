import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { flushSync } from 'react-dom'

import { LANDSCAPE_FLIP_ATTR, LANDSCAPE_LOCK_ATTR } from '@/lib/page-turn'
import { phonePosture } from '@/lib/phone-posture'
import { transitionLayout } from '@/lib/view-transition'

// A phone: finger input on a screen whose short side is a phone's. An iPad, or a laptop with a touch screen, is not
export const PHONE_QUERY =
  '(pointer: coarse) and (orientation: portrait) and (max-width: 500px), (pointer: coarse) and (orientation: landscape) and (max-height: 500px)'

// What keeps the player on its side, while anything does
interface Hold {
  // 'lock': Lock Landscape, until it is unlocked, however the phone is turned (for watching lying down).
  // 'fullscreen': Full Screen on a phone, which has no upright full screen: on its side until the phone, once
  // turned on its side, is turned upright again, as in YouTube's app; staying upright never ends it
  reason: 'lock' | 'fullscreen'
  // 'native': the browser holds the orientation, in fullscreen (Android). 'turned': nothing can (iPhone), so the
  // page turns itself on its side while the screen stands upright. 'system': the screen is on its side and turns
  // with the phone (Full Screen only, once the phone is on its side)
  mode: 'native' | 'turned' | 'system'
  // The fullscreen this hold entered, which ends with it
  entered: boolean
  // Native Full Screen: the phone's motion sensor has seen it on its side. The orientation lock holds the screen
  // on its side whichever way the phone is held, so only the sensor can tell when it is turned upright again
  sideways: boolean
}

// For this visit: from one song to the next. Full Screen ends when the player is left; Lock Landscape stays
const holdAtom = atom<Hold | null>(null)
// A turned page the other way round, top to the screen's left, for a phone held top to the right: the system
// won't turn it while its rotation lock holds the screen upright
const landscapeFlipAtom = atom(false)
// On a phone on its side, the watch page instead of the full-screen player: asked for with Exit Fullscreen there,
// as Full Screen upright asks for the player on its side (owner, 2026-10-25). Until the phone is turned upright,
// or Full Screen is pressed again
const sideWatchAtom = atom(false)

// How long the screen must stay upright before that counts as the phone turned upright. A phone set down on a dock,
// or tilted on the way, can turn the screen upright and back within a moment; that must not end Full Screen or
// bring the watch page back (owner, 2026-10-25)
export const UPRIGHT_SETTLE_MS = 350

// `onUpright` once the screen has stayed upright for UPRIGHT_SETTLE_MS, `onLandscape` at once when it turns on its
// side (a turn there that undoes a pending upright cancels it)
export const followUpright = (
  onUpright: () => void,
  onLandscape?: () => void
) => {
  const landscape = matchMedia('(orientation: landscape)')
  let timer: ReturnType<typeof setTimeout> | undefined
  const onChange = () => {
    clearTimeout(timer)
    if (landscape.matches) {
      onLandscape?.()
    } else {
      timer = setTimeout(onUpright, UPRIGHT_SETTLE_MS)
    }
  }
  landscape.addEventListener('change', onChange)
  return () => {
    clearTimeout(timer)
    landscape.removeEventListener('change', onChange)
  }
}

export const useSideWatch = () => useAtomValue(sideWatchAtom)

export const usePageTurned = () => useAtomValue(holdAtom)?.mode === 'turned'
export const useLandscapeHeld = () => useAtomValue(holdAtom) !== null

const landscapeNow = () => matchMedia('(orientation: landscape)').matches
const canLock = () => typeof screen.orientation?.lock === 'function'

const enterFullscreen = async () => {
  if (!document.fullscreenEnabled || document.fullscreenElement) {
    return false
  }
  await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
  return true
}

const lockNatively = async () => {
  const entered = await enterFullscreen()
  try {
    await screen.orientation.lock('landscape')
  } catch (error) {
    if (entered) {
      await document.exitFullscreen()
    }
    throw error
  }
  return entered
}

const letGo = (hold: Hold) => {
  if (hold.mode === 'native') {
    screen.orientation.unlock()
  }
  if (hold.entered && document.fullscreenElement) {
    void document.exitFullscreen()
  }
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

type SetHold = (hold: Hold | null) => void

// Before paint, so a turn's view transition snapshots the page already turned
const markHold = (hold: Hold, flipped: boolean) => {
  const root = document.documentElement
  const turned = hold.mode === 'turned'
  root.toggleAttribute(LANDSCAPE_LOCK_ATTR, turned)
  root.toggleAttribute(LANDSCAPE_FLIP_ATTR, turned && flipped)
  // iPhone has no fullscreen for a page: there Full Screen on its side hides the app's top bar instead
  const immersive = hold.mode === 'system' && !hold.entered
  if (immersive) {
    root.dataset.immersive = ''
  }
  return () => {
    root.removeAttribute(LANDSCAPE_LOCK_ATTR)
    root.removeAttribute(LANDSCAPE_FLIP_ATTR)
    if (immersive) {
      delete root.dataset.immersive
    }
  }
}

// Full Screen without a native lock follows the screen's own turns. The phone turned on its side takes over from
// the turned page (which lays out upright on a screen on its side anyway, so nothing turns twice), synchronously, in
// the frame the screen turns, so no frame shows the page turned the wrong way. Turned upright from there, it ends,
// back to the watch page, once the screen has stayed upright (followUpright): an upright moment while the phone is
// set down doesn't end it
const followScreen = (hold: Hold, setHold: SetHold) =>
  followUpright(
    () => {
      if (hold.mode === 'system') {
        letGo(hold)
        setHold(null)
      }
    },
    () => {
      if (hold.mode === 'turned') {
        flushSync(() => {
          setHold({ ...hold, mode: 'system', sideways: true })
        })
      }
    }
  )

// Native Full Screen: the screen stays on its side under the lock, so the phone's motion says when it was turned
// on its side and then upright again. Android gives motion without asking; a phone that sends none stays in Full
// Screen until its exit button
const followMotion = (hold: Hold, setHold: SetHold) => {
  const onMotion = ({ accelerationIncludingGravity: g }: DeviceMotionEvent) => {
    const posture = phonePosture(g?.x, g?.y)
    if (posture === 'sideways' && !hold.sideways) {
      setHold({ ...hold, sideways: true })
    } else if (posture === 'upright' && hold.sideways) {
      letGo(hold)
      setHold(null)
    }
  }
  window.addEventListener('devicemotion', onMotion)
  return () => {
    window.removeEventListener('devicemotion', onMotion)
  }
}

const follow = (hold: Hold, setHold: SetHold) =>
  hold.mode === 'native'
    ? followMotion(hold, setHold)
    : followScreen(hold, setHold)

// What follows a hold, mounted once with the player page (not per song). `active` while the stage is on the
// page: a page elsewhere in the app, or the player still loading, is never turned
export const useLandscapeHold = (active: boolean) => {
  const [hold, setHold] = useAtom(holdAtom)
  const flipped = useAtomValue(landscapeFlipAtom)
  const setSideWatch = useSetAtom(sideWatchAtom)

  // The watch page asked for on its side lasts until the phone is turned upright, and the player page is left
  useEffect(() => {
    const stop = followUpright(() => {
      setSideWatch(false)
    })
    return () => {
      stop()
      setSideWatch(false)
    }
  }, [setSideWatch])

  // Fullscreen ending ends the hold that entered it, whatever ended it (the browser lets go of the orientation
  // with it)
  useEffect(() => {
    const sync = () => {
      if (!document.fullscreenElement) {
        setHold((current) =>
          current !== null && (current.mode === 'native' || current.entered)
            ? null
            : current
        )
      }
    }
    sync()
    document.addEventListener('fullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
    }
  }, [setHold])

  useLayoutEffect(
    () => (active && hold !== null ? markHold(hold, flipped) : undefined),
    [active, hold, flipped]
  )

  const fullscreen = hold?.reason === 'fullscreen' ? hold : null
  useEffect(
    () => (fullscreen === null ? undefined : follow(fullscreen, setHold)),
    [fullscreen, setHold]
  )

  // Leaving the player leaves Full Screen
  const holdRef = useRef(hold)
  useLayoutEffect(() => {
    holdRef.current = hold
  })
  useEffect(
    () => () => {
      const { current } = holdRef
      if (current?.reason === 'fullscreen') {
        letGo(current)
        setHold(null)
      }
    },
    [setHold]
  )
}

const clearHold = (setHold: SetHold) => () => {
  setHold(null)
}

// Lock Landscape and, on a phone, Full Screen. Both hold the player on its side; Full Screen lets go when the
// phone is turned upright, Lock Landscape doesn't. Exit Fullscreen ends either
export const useLandscapeLock = () => {
  const [hold, setHold] = useAtom(holdAtom)
  const [flipped, setFlipped] = useAtom(landscapeFlipAtom)
  const [sideWatch, setSideWatch] = useAtom(sideWatchAtom)

  const release = (current: Hold) => {
    letGo(current)
    const clear = clearHold(setHold)
    if (current.mode === 'turned') {
      turn(flipped ? 'turn-back' : 'turn-out', clear)
    } else if (current.mode === 'system' && !current.entered) {
      transitionLayout('zoom', clear)
    } else {
      clear()
    }
  }

  // Fullscreen needs the tap that asked for it, so this runs straight from the click
  const take = async (reason: Hold['reason']) => {
    setFlipped(false)
    // Full Screen on a phone already on its side locks nothing: the screen turns with the phone, and turning it
    // upright ends it
    if (reason === 'fullscreen' && landscapeNow()) {
      let entered = false
      try {
        entered = await enterFullscreen()
      } catch {
        // The browser refused fullscreen: the player still takes the whole screen
      }
      const next: Hold = { entered, mode: 'system', reason, sideways: true }
      const show = () => {
        setSideWatch(false)
        setHold(next)
      }
      if (entered) {
        show()
      } else {
        transitionLayout('zoom', show)
      }
      return
    }
    if (canLock()) {
      try {
        const entered = await lockNatively()
        setHold({ entered, mode: 'native', reason, sideways: false })
        return
      } catch {
        // No lock here (iPhone, iPad Safari, a browser that refuses it): turn the page instead
      }
    }
    turn('turn-in', () => {
      setHold({ entered: false, mode: 'turned', reason, sideways: false })
    })
  }

  const toggleLock = async () => {
    if (hold === null) {
      await take('lock')
      return
    }
    if (hold.reason === 'lock') {
      release(hold)
      return
    }
    // Full Screen becomes Lock Landscape: still on its side, and now it stays there when the phone is turned
    // upright. A screen that was turning with the phone is held from here: by the browser in fullscreen
    // (Android), else by turning the page once the phone is upright
    if (hold.mode !== 'system') {
      setHold({ ...hold, reason: 'lock' })
      return
    }
    if (hold.entered && canLock()) {
      try {
        await screen.orientation.lock('landscape')
        setHold({ ...hold, mode: 'native', reason: 'lock' })
        return
      } catch {
        // Turn the page instead
      }
    }
    setHold({ ...hold, mode: 'turned', reason: 'lock' })
  }

  // On a phone on its side the full-screen player is up whether the phone was turned or Full Screen held it there:
  // the button leaves it for the watch page (a turned page excepted, whose screen stands upright: leaving turns it
  // back upright)
  const onItsSide = landscapeNow() && !sideWatch && hold?.mode !== 'turned'
  const toggleFullscreen = async () => {
    if (onItsSide) {
      if (hold !== null) {
        letGo(hold)
      }
      transitionLayout('zoom', () => {
        setHold(null)
        setSideWatch(true)
      })
    } else if (hold === null) {
      await take('fullscreen')
    } else {
      release(hold)
    }
  }

  const flip = () => {
    turn('flip', () => {
      setFlipped(!flipped)
    })
  }

  return {
    flip,
    held: hold !== null,
    locked: hold?.reason === 'lock',
    sideWatch,
    toggleFullscreen,
    toggleLock,
    turned: hold?.mode === 'turned',
  }
}
