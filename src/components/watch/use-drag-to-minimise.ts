import { useEffect } from 'react'
import type { RefObject } from 'react'
import { useNavigate } from 'react-router'
import type { NavigateFunction } from 'react-router'

import { dragEngine } from '@/components/player-stage/youtube-engine'
import { reducedMotion } from '@/lib/reduced-motion'

// A finger moving this far, mostly downwards, starts the drag; sideways first, it is left to the stage
const START_PX = 12
// The share of the screen's height a drag covers to bring the video to its smallest
const FULL_DRAG = 0.5
const SMALLEST = 0.45
// Let go past this share of the full drag, or flicked down this fast, the player minimises; otherwise it springs back
const MINIMISE_AT = 0.3
const FLICK_PX_PER_MS = 0.6
const FLICK_WINDOW_MS = 80
const SETTLE_MS = 250
// The click a finger lifting from a drag still sends, which the stage would take as a tap
const SWALLOW_CLICK_MS = 400

interface Drag {
  id: number
  x: number
  y: number
  // Set once the finger has moved far enough downwards
  live: boolean
  // Where the video sits in the stage, so it shrinks with it
  videoLeft: number
  videoTop: number
  width: number
  samples: { y: number; at: number }[]
}

// The video's own transform for the stage's: the stage scales from its top left, the video from its own
const videoTransform = (drag: Drag, tx: number, ty: number, scale: number) =>
  `translate(${tx + (scale - 1) * drag.videoLeft}px, ${ty + (scale - 1) * drag.videoTop}px) scale(${scale})`

// How far a drag of `dy` px has taken the video, 0 to 1
const progressOf = (dy: number) =>
  Math.min(1, dy / (window.innerHeight * FULL_DRAG))

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

// The drag on one stage element, until the cleanup; `minimise` when it is let go far or fast enough
const followDrags = (stage: HTMLDivElement, minimise: () => void) => {
  let drag: Drag | null = null
  const below = () =>
    [...(stage.parentElement?.children ?? [])].filter(
      (el): el is HTMLElement => el !== stage && el instanceof HTMLElement
    )

  const show = (current: Drag, dy: number) => {
    const progress = progressOf(dy)
    const scale = 1 - (1 - SMALLEST) * progress
    const tx = (current.width * (1 - scale)) / 2
    stage.style.transform = `translate(${tx}px, ${dy}px) scale(${scale})`
    dragEngine(videoTransform(current, tx, dy, scale))
    for (const el of below()) {
      el.style.opacity = String(Math.max(0, 1 - progress * 1.6))
    }
  }

  const springBack = () => {
    const from = stage.style.transform
    stage.style.transform = ''
    dragEngine(null, { settle: true })
    if (!reducedMotion() && from !== '') {
      stage.animate([{ transform: from }, { transform: 'none' }], {
        duration: SETTLE_MS,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
      })
    }
    for (const el of below()) {
      el.style.opacity = ''
    }
  }

  const onDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' || drag !== null) {
      return
    }
    const box = stage.getBoundingClientRect()
    const video = document
      .querySelector('[data-stage-video]')
      ?.getBoundingClientRect()
    drag = {
      id: event.pointerId,
      live: false,
      samples: [{ at: event.timeStamp, y: event.clientY }],
      videoLeft: (video?.left ?? box.left) - box.left,
      videoTop: (video?.top ?? box.top) - box.top,
      width: box.width,
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
    if (!current.live) {
      if (Math.abs(dx) > START_PX && Math.abs(dx) >= dy) {
        drag = null
        return
      }
      if (dy < START_PX || dy < Math.abs(dx) * 1.5) {
        return
      }
      current.live = true
      stage.setPointerCapture(event.pointerId)
    }
    current.samples = [
      ...current.samples.filter(
        (sample) => event.timeStamp - sample.at < FLICK_WINDOW_MS
      ),
      { at: event.timeStamp, y: event.clientY },
    ]
    show(current, Math.max(0, dy))
  }
  const onUp = (event: PointerEvent) => {
    const current = drag
    if (current?.id !== event.pointerId) {
      return
    }
    drag = null
    if (!current.live) {
      return
    }
    swallowNextClick()
    const dy = event.clientY - current.y
    const [first] = current.samples
    const span = first === undefined ? 0 : event.timeStamp - first.at
    const speed =
      first === undefined || span <= 0 ? 0 : (event.clientY - first.y) / span
    const going =
      event.type === 'pointerup' &&
      (progressOf(dy) >= MINIMISE_AT || speed >= FLICK_PX_PER_MS)
    if (going) {
      minimise()
    } else {
      springBack()
    }
  }

  stage.addEventListener('pointerdown', onDown)
  stage.addEventListener('pointermove', onMove)
  stage.addEventListener('pointerup', onUp)
  stage.addEventListener('pointercancel', onUp)
  return () => {
    stage.removeEventListener('pointerdown', onDown)
    stage.removeEventListener('pointermove', onMove)
    stage.removeEventListener('pointerup', onUp)
    stage.removeEventListener('pointercancel', onUp)
  }
}

// Back to the tab the player was opened from, or Home when it was opened first (a link from outside)
const minimiseTo = (navigate: NavigateFunction) => {
  // React Router keeps the entry's place in the history as `idx`: above 0, there is a page to go back to
  const state: unknown = window.history.state
  const idx =
    typeof state === 'object' && state !== null && 'idx' in state
      ? state.idx
      : 0
  if (typeof idx === 'number' && idx > 0) {
    void navigate(-1)
  } else {
    void navigate('/')
  }
}

// The installed app's player held upright: dragging the video down shrinks it towards the mini bar, centred, and
// fades the page under it; let go far or fast enough and the player minimises (back to the tab it came from, where
// the video flies into the mini bar: youtube-engine › fly), else it springs back. A finger only: a mouse keeps the
// stage's clicks. The stage's own taps still work, as a drag swallows only its own click
export const useDragToMinimise = (
  stageRef: RefObject<HTMLDivElement | null>,
  enabled: boolean
) => {
  const navigate = useNavigate()
  useEffect(() => {
    const stage = stageRef.current
    return enabled && stage !== null
      ? followDrags(stage, () => {
          minimiseTo(navigate)
        })
      : undefined
  }, [stageRef, enabled, navigate])
}
