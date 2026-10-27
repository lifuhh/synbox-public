import type { RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

// How often an open menu is looked at while the mouse is away from the player, so the UI goes the moment it closes
const MENU_POLL_MS = 100

const onWatchPage = () => 'watch' in document.documentElement.dataset

// A finger on the picture or the lyrics is the stage's own tap, which use-stage-taps decides once it lifts: a single
// tap shows or hides the controls, a double tap seeks and leaves them as they are, a tap on the lyrics opens Lyrics
// Style. So only a finger on a control counts as activity as it lands, and not one in a sheet (Lyrics Style opened
// from the lyrics keeps the controls away, the lyrics in view)
const CONTROL =
  'button, a, input, select, [role="slider"], [data-player-chrome]'
const fingerWakes = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest('[role="dialog"]') === null &&
  target.closest(CONTROL) !== null

// Anything marked data-player-chrome inside `root` holds the floating UI open while a menu from it is open, and
// with a mouse also while the pointer rests on it (`hover`) or keyboard focus is inside it (`focus`). A touch
// screen counts menus only: iOS keeps the last tapped element in :hover, and a dragged slider keeps its thumb
// focused, so either would hold the UI open for good
const chromeBusy = (
  root: ParentNode,
  { hover, focus }: { hover: boolean; focus: boolean }
) => {
  const canHover = matchMedia('(hover: hover)').matches
  return [...root.querySelectorAll('[data-player-chrome]')].some(
    (element) =>
      // aria-expanded rather than data-state, which a tooltip on the same trigger overwrites
      element.querySelector('[aria-expanded=true]') !== null ||
      (canHover &&
        ((hover && element.matches(':hover')) ||
          (focus && element.querySelector(':focus-visible') !== null)))
  )
}

// Idle `ms` after the last pointer or key input, and not while the UI is busy. The player is the window while the
// stage is the whole screen, and the stage alone on the watch page: there the top bar, the Lyrics Style panel and
// the rest of the page are away from it, even where they lie over the video, and their menus and hover hold
// nothing. Any pointer in the player counts as input; on the watch page one elsewhere doesn't, so scrolling the
// page under it doesn't bring up its controls. A mouse leaving the player idles it at once and marks it
// `outside`, as on YouTube: the controls fade the moment the mouse goes, playing or paused, unless one of their
// menus is open (then they go the moment it closes). A mouse moving on the page away from the player counts as
// leaving it too: one that never crossed it (the page opened under a mouse resting elsewhere) sends no leave.
// Keyboard focus in the controls holds them only when Tab put it there: a click focuses the button it lands on,
// and a key pressed after it (Space, an arrow) makes that button :focus-visible, which held the UI for good
export const useIdle = (
  ms: number,
  stageRef: RefObject<HTMLElement | null>
) => {
  const [idle, setIdle] = useState(false)
  // Put to sleep on purpose (a tap that hides the controls), not by the idle time: nothing holds them then
  const [dismissed, setDismissed] = useState(false)
  const [outside, setOutside] = useState(false)
  const outsideRef = useRef(false)
  const pressFocusRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const busy = useCallback(
    (hover: boolean) => {
      const root = onWatchPage() ? stageRef.current : document
      return (
        root !== null &&
        chromeBusy(root, { focus: !pressFocusRef.current, hover })
      )
    },
    [stageRef]
  )

  const wake = useCallback(() => {
    setIdle(false)
    setDismissed(false)
    clearTimeout(timerRef.current)
    const check = () => {
      if (busy(true)) {
        timerRef.current = setTimeout(check, ms)
      } else {
        setIdle(true)
      }
    }
    timerRef.current = setTimeout(check, ms)
  }, [ms, busy])
  const sleep = () => {
    clearTimeout(timerRef.current)
    setIdle(true)
    setDismissed(true)
  }

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- arriving on the stage counts as activity: show the controls and start the idle timer
    wake()
    const inPlayer = (target: EventTarget | null) => {
      const stage = stageRef.current
      return (
        !onWatchPage() ||
        (stage !== null && target instanceof Node && stage.contains(target))
      )
    }
    const leave = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') {
        return
      }
      outsideRef.current = true
      setOutside(true)
      clearTimeout(timerRef.current)
      const check = () => {
        if (!outsideRef.current) {
          return
        }
        if (busy(false)) {
          timerRef.current = setTimeout(check, MENU_POLL_MS)
        } else {
          setIdle(true)
        }
      }
      check()
    }
    const wakeFromPointer = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && !fingerWakes(event.target)) {
        return
      }
      if (inPlayer(event.target)) {
        outsideRef.current = false
        setOutside(false)
        wake()
      } else if (!outsideRef.current) {
        leave(event)
      }
    }
    const press = (event: PointerEvent) => {
      pressFocusRef.current = true
      wakeFromPointer(event)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        pressFocusRef.current = false
      }
      wake()
    }
    const stage = stageRef.current
    const leaveStage = (event: PointerEvent) => {
      if (onWatchPage()) {
        leave(event)
      }
    }
    const leaveWindow = (event: PointerEvent) => {
      if (!onWatchPage()) {
        leave(event)
      }
    }
    window.addEventListener('pointermove', wakeFromPointer)
    window.addEventListener('pointerdown', press)
    window.addEventListener('keydown', key)
    stage?.addEventListener('pointerleave', leaveStage)
    document.documentElement.addEventListener('pointerleave', leaveWindow)
    return () => {
      clearTimeout(timerRef.current)
      window.removeEventListener('pointermove', wakeFromPointer)
      window.removeEventListener('pointerdown', press)
      window.removeEventListener('keydown', key)
      stage?.removeEventListener('pointerleave', leaveStage)
      document.documentElement.removeEventListener('pointerleave', leaveWindow)
    }
  }, [wake, busy, stageRef])
  return { dismissed, idle, outside, sleep, wake }
}
