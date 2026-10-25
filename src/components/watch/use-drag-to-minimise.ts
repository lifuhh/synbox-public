import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'
import { useLocation, useNavigate } from 'react-router'
import type { NavigateFunction } from 'react-router'

import {
  dragEngine,
  engineBox,
  stopFlight,
} from '@/components/player-stage/youtube-engine'
import type { ScreenBox } from '@/components/player-stage/youtube-engine'
import { THUMB_RADIUS_PX } from '@/components/shared/mini-bar-view'
import { historyIdx, returnTab } from '@/components/shared/tab-bar'
import { openedBy } from '@/lib/listening/store'
import { reducedMotion } from '@/lib/reduced-motion'

// A finger moving this far, mostly downwards, starts the drag; sideways first, it is left to the stage
const START_PX = 12
// Let go past this share of the way to the mini bar, or flicked down this fast, the player minimises; otherwise it
// springs back
const MINIMISE_AT = 0.3
const FLICK_PX_PER_MS = 0.6
const FLICK_WINDOW_MS = 80
// The rest of the way, from where the finger let go
const SETTLE_MS = 280
// The click a finger lifting from a drag still sends, which the stage would take as a tap
const SWALLOW_CLICK_MS = 400
// The mini bar fades in when it mounts; landing from a drag it is already showing (mini-bar.tsx › data-landed)
const LANDED_MS = 500
// Back from the mini bar, the drag's way in reverse at one pace, once the stage has the video; a stage that
// hasn't placed it by GROW_WAIT_MS gets the page shown as it is
const GROW_MS = 280
const GROW_WAIT_MS = 1000

interface Drag {
  id: number
  x: number
  y: number
  // Set once the finger has moved far enough downwards: the video's box as placed, and the mini bar's thumbnail
  // where it lands
  path: { from: ScreenBox; to: ScreenBox } | null
  samples: { y: number; at: number }[]
}

const between = (from: ScreenBox, to: ScreenBox, t: number): ScreenBox => ({
  height: from.height + (to.height - from.height) * t,
  left: from.left + (to.left - from.left) * t,
  top: from.top + (to.top - from.top) * t,
  width: from.width + (to.width - from.width) * t,
})

// cubic-bezier(0.2, 0, 0, 1), near enough for the last few hundred milliseconds of a drag
const easeOut = (t: number) => 1 - (1 - t) ** 3

// The mini bar's stand-in on the player (minimise-ghost.tsx › MinimiseGhost)
const ghost = () => document.querySelector<HTMLElement>('[data-minimise-ghost]')

// Where the video goes: from the stage to the thumbnail of the mini bar's stand-in
const pathOf = (bar: HTMLElement): Drag['path'] => {
  const from = engineBox()
  const to = bar.querySelector('[data-mini-thumb]')?.getBoundingClientRect()
  return from === null || to === undefined || to.top <= from.top
    ? null
    : { from, to }
}

const swallow = (event: MouseEvent) => {
  event.stopPropagation()
  event.preventDefault()
}
const swallowNextClick = () => {
  window.addEventListener('click', swallow, { capture: true, once: true })
  setTimeout(() => {
    window.removeEventListener('click', swallow, { capture: true })
  }, SWALLOW_CLICK_MS)
}

// The drag on one stage element, until the cleanup; `minimise` once the video has landed on the mini bar. `grow`:
// the page was opened from the mini bar, so it first runs the drag backwards, from the bar to the stage
const followDrags = (
  stage: HTMLDivElement,
  minimise: () => void,
  grow: boolean
) => {
  let drag: Drag | null = null
  // How far the video is on its way to the mini bar, 0 to 1, drawn once per frame
  let shown = 0
  let wanted = 0
  let frame = 0
  let landed = false
  const page = stage.parentElement

  const paint = (path: { from: ScreenBox; to: ScreenBox }, t: number) => {
    shown = t
    dragEngine({
      from: path.from,
      radiusPx: THUMB_RADIUS_PX * t,
      to: between(path.from, path.to, t),
    })
    if (page !== null) {
      page.style.opacity = String(Math.max(0, 1 - t * 2))
    }
    const bar = ghost()
    if (bar !== null) {
      bar.style.opacity = String(t)
    }
  }

  const reset = () => {
    cancelAnimationFrame(frame)
    frame = 0
    if (!landed) {
      dragEngine(null)
    }
    if (page !== null) {
      page.style.opacity = ''
      page.style.willChange = ''
    }
    const bar = ghost()
    if (bar !== null) {
      bar.style.opacity = ''
      bar.style.visibility = ''
    }
  }

  // The finger's place, drawn on the next frame
  const follow = (path: { from: ScreenBox; to: ScreenBox }, t: number) => {
    wanted = t
    frame ||= requestAnimationFrame(() => {
      frame = 0
      paint(path, wanted)
    })
  }

  // The rest of the way to `end` (1, the mini bar; 0, back on the stage) over `ms`, then `done`
  const settle = (
    path: { from: ScreenBox; to: ScreenBox },
    end: number,
    done: () => void,
    ms = SETTLE_MS * Math.max(0.4, Math.abs(end - shown))
  ) => {
    cancelAnimationFrame(frame)
    const start = shown
    const duration = reducedMotion() ? 0 : ms
    const began = performance.now()
    const step = (now: number) => {
      const t = duration === 0 ? 1 : Math.min(1, (now - began) / duration)
      paint(path, start + (end - start) * easeOut(t))
      if (t < 1) {
        frame = requestAnimationFrame(step)
      } else {
        frame = 0
        done()
      }
    }
    frame = requestAnimationFrame(step)
  }

  const showGhost = (bar: HTMLElement, opacity: number) => {
    bar.style.opacity = String(opacity)
    bar.style.visibility = 'visible'
    if (page !== null) {
      page.style.willChange = 'opacity'
    }
  }
  const begin = (): Drag['path'] => {
    const bar = ghost()
    const path = bar === null ? null : pathOf(bar)
    if (bar !== null && path !== null) {
      showGhost(bar, 0)
    }
    return path
  }

  // The page and the bar's stand-in as the drag leaves them on the bar, held until the stage places the video, which
  // then grows back out of the thumbnail (the flight the engine starts is dropped)
  const growFromBar = () => {
    const bar = ghost()
    if (bar === null) {
      return
    }
    showGhost(bar, 1)
    if (page !== null) {
      page.style.opacity = '0'
    }
    const began = performance.now()
    const start = () => {
      // Measured where the stage placed it, not mid-flight
      stopFlight()
      const path = pathOf(bar)
      if (path === null) {
        frame =
          performance.now() - began < GROW_WAIT_MS
            ? requestAnimationFrame(start)
            : 0
        if (frame === 0) {
          reset()
        }
        return
      }
      paint(path, 1)
      settle(path, 0, reset, GROW_MS)
    }
    start()
  }

  const onDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' || drag !== null || frame !== 0) {
      return
    }
    drag = {
      id: event.pointerId,
      path: null,
      samples: [{ at: event.timeStamp, y: event.clientY }],
      x: event.clientX,
      y: event.clientY,
    }
  }
  const onMove = (event: PointerEvent) => {
    const current = drag
    if (current?.id !== event.pointerId) {
      return
    }
    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    if (current.path === null) {
      if (Math.abs(dx) > START_PX && Math.abs(dx) >= dy) {
        drag = null
        return
      }
      if (dy < START_PX || dy < Math.abs(dx) * 1.5) {
        return
      }
      current.path = begin()
      if (current.path === null) {
        drag = null
        return
      }
      stage.setPointerCapture(event.pointerId)
    }
    current.samples = [
      ...current.samples.filter(
        (sample) => event.timeStamp - sample.at < FLICK_WINDOW_MS
      ),
      { at: event.timeStamp, y: event.clientY },
    ]
    // The video's top edge stays under the finger the whole way down
    const { from, to } = current.path
    follow(current.path, Math.min(1, Math.max(0, dy / (to.top - from.top))))
  }
  const onUp = (event: PointerEvent) => {
    const current = drag
    if (current?.id !== event.pointerId) {
      return
    }
    drag = null
    const { path } = current
    if (path === null) {
      return
    }
    swallowNextClick()
    const [first] = current.samples
    const span = first === undefined ? 0 : event.timeStamp - first.at
    const speed =
      first === undefined || span <= 0 ? 0 : (event.clientY - first.y) / span
    const going =
      event.type === 'pointerup' &&
      (wanted >= MINIMISE_AT || speed >= FLICK_PX_PER_MS)
    if (going) {
      settle(path, 1, () => {
        landed = true
        minimise()
      })
    } else {
      settle(path, 0, reset)
    }
  }

  stage.addEventListener('pointerdown', onDown)
  stage.addEventListener('pointermove', onMove)
  stage.addEventListener('pointerup', onUp)
  stage.addEventListener('pointercancel', onUp)
  if (grow) {
    growFromBar()
  }
  return () => {
    stage.removeEventListener('pointerdown', onDown)
    stage.removeEventListener('pointermove', onMove)
    stage.removeEventListener('pointerup', onUp)
    stage.removeEventListener('pointercancel', onUp)
    reset()
  }
}

// Back to the tab page the player was opened from, through the history so Back doesn't return to the player; Home
// when it was opened first (a link from outside). Never a step back alone: that can land on the song before
const minimiseTo = (navigate: NavigateFunction) => {
  const root = document.documentElement
  root.toggleAttribute('data-minimised', true)
  setTimeout(() => {
    delete root.dataset.minimised
  }, LANDED_MS)
  const tab = returnTab()
  const idx = historyIdx()
  if (tab !== null && tab.idx < idx) {
    void navigate(tab.idx - idx)
  } else {
    void navigate(tab?.path ?? '/')
  }
}

// The installed app's player held upright: dragging the video down carries it to the mini bar's thumbnail, its top
// edge under the finger, while the player fades and the tabs with the mini bar fade in where they will be. Let go
// far or fast enough and it lands there and the player minimises (back to the tab it came from, where the real
// mini bar takes the video from the same box), else it springs back. Opened from the mini bar, the page plays the
// same way back up, untouched. A finger only: a mouse keeps the stage's clicks. The stage's own taps still work, as
// a drag swallows only its own click. Any navigation puts the page back. Before paint, so a page opened from the
// bar never shows a frame of itself in full first
export const useDragToMinimise = (
  stageRef: RefObject<HTMLDivElement | null>,
  enabled: boolean
) => {
  const navigate = useNavigate()
  const { key } = useLocation()
  const grow = openedBy(useLocation().state) === 'resume'
  useLayoutEffect(() => {
    const stage = stageRef.current
    return enabled && stage !== null && key !== ''
      ? followDrags(
          stage,
          () => {
            minimiseTo(navigate)
          },
          grow
        )
      : undefined
  }, [stageRef, enabled, navigate, key, grow])
}
