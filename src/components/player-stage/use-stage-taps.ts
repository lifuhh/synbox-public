import type { MouseEvent, PointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

import { fractionAcross } from '@/lib/page-turn'

export const TAP_SEEK_SEC = 10
// How long a tap on a side waits for a second one before it counts as a single tap
const DOUBLE_TAP_MS = 280
// Taps that follow a double tap within this long keep seeking the same way
const STREAK_MS = 700
// A tap passed on from the lyrics may also reach the stage as the browser's own click, straight after
const FORWARDED_CLICK_MS = 100

type Side = 'back' | 'forward'

// The left and right thirds of the stage skip; the middle only shows and hides the controls
const sideAt = (x: number): Side | null => {
  if (x < 1 / 3) {
    return 'back'
  }
  return x > 2 / 3 ? 'forward' : null
}
// What a single tap does, decided as it lands, while the controls still show what was there before it
type TapIntent = 'toggle' | 'hide' | 'reveal'

export interface SeekFlash {
  side: Side
  seconds: number
  // Restarts the flash's animation on every added tap
  key: number
}

interface StageTapOptions {
  // A paused or unstarted song shows its cover, and a tap there plays it
  showCover: boolean
  controlsVisible: boolean
  togglePlay: () => void
  hideControls: () => void
  seekBy: (seconds: number) => void
  toggleFullscreen: () => void
}

// A click toggles playback and a double click toggles fullscreen. On a touch screen a tap shows the
// controls, or hides them when they are already up, and plays from a paused song's cover; a double tap
// on the left or right third skips back or forward, and each further quick tap there skips again, as in
// YouTube's own app. A tap on a side waits a moment for its second tap, so a double tap never also
// flashes the controls
export const useStageTaps = ({
  showCover,
  controlsVisible,
  togglePlay,
  hideControls,
  seekBy,
  toggleFullscreen,
}: StageTapOptions) => {
  const intentRef = useRef<TapIntent>('toggle')
  const pointerRef = useRef('mouse')
  const sideRef = useRef<Side | null>(null)
  const pendingRef = useRef<{
    side: Side
    timer: ReturnType<typeof setTimeout>
  } | null>(null)
  const streakRef = useRef<{ side: Side; until: number } | null>(null)
  const [flash, setFlash] = useState<SeekFlash | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )

  useEffect(
    () => () => {
      clearTimeout(pendingRef.current?.timer)
      clearTimeout(flashTimer.current)
    },
    []
  )

  const runSingleTap = (intent: TapIntent) => {
    if (intent === 'toggle') {
      togglePlay()
    } else if (intent === 'hide') {
      hideControls()
    }
  }

  const skip = (side: Side) => {
    seekBy(side === 'back' ? -TAP_SEEK_SEC : TAP_SEEK_SEC)
    streakRef.current = { side, until: Date.now() + STREAK_MS }
    setFlash((current) => ({
      key: (current?.key ?? 0) + 1,
      seconds:
        current?.side === side ? current.seconds + TAP_SEEK_SEC : TAP_SEEK_SEC,
      side,
    }))
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => {
      setFlash(null)
    }, STREAK_MS)
  }

  const press = (pointerType: string, across: number) => {
    pointerRef.current = pointerType
    if (pointerType === 'mouse' || showCover) {
      intentRef.current = 'toggle'
    } else {
      intentRef.current = controlsVisible ? 'hide' : 'reveal'
    }
    sideRef.current = sideAt(across)
  }
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    press(event.pointerType, fractionAcross(event, event.currentTarget))
  }

  const forwardedAt = useRef(0)
  const onClick = () => {
    const side = sideRef.current
    if (pointerRef.current === 'mouse' || side === null) {
      runSingleTap(intentRef.current)
      return
    }
    const streak = streakRef.current
    if (streak?.side === side && Date.now() < streak.until) {
      skip(side)
      return
    }
    const pending = pendingRef.current
    if (pending?.side === side) {
      clearTimeout(pending.timer)
      pendingRef.current = null
      skip(side)
      return
    }
    if (pending) {
      clearTimeout(pending.timer)
    }
    const intent = intentRef.current
    pendingRef.current = {
      side,
      timer: setTimeout(() => {
        pendingRef.current = null
        runSingleTap(intent)
      }, DOUBLE_TAP_MS),
    }
  }

  const onDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (pointerRef.current === 'mouse') {
      event.preventDefault()
      toggleFullscreen()
    }
  }

  // A tap that landed on something over the stage (the lyrics) and is passed on to it: `press` as it lands,
  // while the controls still show what was there before it, with how far across the stage (0 to 1), and
  // `forward` once it lifts without dragging
  const forward = () => {
    forwardedAt.current = performance.now()
    onClick()
  }
  const onStageClick = () => {
    if (performance.now() - forwardedAt.current >= FORWARDED_CLICK_MS) {
      onClick()
    }
  }

  return {
    flash,
    forward,
    handlers: { onClick: onStageClick, onDoubleClick, onPointerDown },
    press,
  }
}
