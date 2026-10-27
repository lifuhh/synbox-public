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

// A menu, sheet or popover open over the player (Radix marks its content): a press outside it only closes it
const OPEN_OVERLAY =
  ':is([role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"])[data-state="open"]'
// The control bar from its rows' top down to the stage's edge, its whole width. With a mouse its gaps pass presses
// through, so lyrics dragged under it can still be grabbed (stage-controls.tsx › PRESS_THROUGH), but a press there
// is still on the bar
const onControlBar = (x: number, y: number) => {
  const rows = document.querySelector('[data-controls-rows]')
  const bar = rows?.parentElement?.getBoundingClientRect()
  if (!rows || !bar) {
    return false
  }
  return (
    y >= rows.getBoundingClientRect().top &&
    y <= bar.bottom &&
    x >= bar.left &&
    x <= bar.right
  )
}

// A double tap on the left half skips back, on the right half forward (owner, 2026-10-25)
const sideAt = (x: number): Side => (x < 1 / 2 ? 'back' : 'forward')
// What a single tap does, decided as it lands, while the controls still show what was there before it: `style` is a
// finger's tap on the lyrics, which opens Lyrics Style rather than the controls
type TapIntent = 'toggle' | 'hide' | 'reveal' | 'style'
// Where a press landed: the stage (the picture) or the lyrics over it, which pass their taps on to it
export type TapTarget = 'stage' | 'lyrics'

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
  revealControls: () => void
  hideControls: () => void
  openLyricsStyle: () => void
  seekBy: (seconds: number) => void
  toggleFullscreen: () => void
}

// A click toggles playback and a double click toggles fullscreen. On a touch screen a tap shows the
// controls, or hides them when they are already up, and plays from a paused song's cover; a tap on the lyrics opens
// Lyrics Style instead; a double tap on the left or right half (the lyrics included) skips back or forward, and each
// further quick tap there skips again, as in YouTube's own app. A tap waits a moment for its second tap, and a finger
// landing on the stage shows nothing by itself (use-idle › fingerWakes), so a double tap never also brings up the
// controls
export const useStageTaps = ({
  showCover,
  controlsVisible,
  togglePlay,
  revealControls,
  hideControls,
  openLyricsStyle,
  seekBy,
  toggleFullscreen,
}: StageTapOptions) => {
  const intentRef = useRef<TapIntent>('toggle')
  const pointerRef = useRef('mouse')
  const sideRef = useRef<Side | null>(null)
  // Where the latest press landed, read before anything under it handles it
  const pointRef = useRef({ x: -1, y: -1 })
  // A press that closed a menu or sheet, or landed on the control bar, does nothing on the stage: no play/pause,
  // controls, seek or full screen
  const ignoredRef = useRef(false)
  const pendingRef = useRef<{
    side: Side
    timer: ReturnType<typeof setTimeout>
  } | null>(null)
  const streakRef = useRef<{ side: Side; until: number } | null>(null)
  const [flash, setFlash] = useState<SeekFlash | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )

  useEffect(() => {
    const record = (event: globalThis.PointerEvent) => {
      pointRef.current = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener('pointerdown', record, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', record, { capture: true })
      clearTimeout(pendingRef.current?.timer)
      clearTimeout(flashTimer.current)
    }
  }, [])

  const runSingleTap = (intent: TapIntent) => {
    const actions: Record<TapIntent, () => void> = {
      hide: hideControls,
      reveal: revealControls,
      style: openLyricsStyle,
      toggle: togglePlay,
    }
    actions[intent]()
  }

  const skip = (side: Side) => {
    // A seek brings up YouTube's own centre button, which the controls stay up to cover; skipping with them away
    // keeps them away (hideControls: dismissed), and our centre disc alone covers it (center-play-button.tsx)
    if (!controlsVisible) {
      hideControls()
    }
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

  const press = (
    pointerType: string,
    across: number,
    target: TapTarget = 'stage'
  ) => {
    pointerRef.current = pointerType
    ignoredRef.current =
      document.querySelector(OPEN_OVERLAY) !== null ||
      (controlsVisible && onControlBar(pointRef.current.x, pointRef.current.y))
    if (pointerType === 'mouse' || showCover) {
      intentRef.current = 'toggle'
    } else if (target === 'lyrics') {
      intentRef.current = 'style'
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
    if (ignoredRef.current) {
      return
    }
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
    if (pointerRef.current === 'mouse' && !ignoredRef.current) {
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
