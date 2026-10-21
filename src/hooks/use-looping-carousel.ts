import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import {
  easeOutCubic,
  glideMs,
  homeIndex,
  releaseTarget,
  STEP_MS,
} from '@/lib/carousel-motion'

// A finger moving less than this is a tap, not a drag
const DRAG_SLOP_PX = 6
// Release speed is read over the finger's last VELOCITY_WINDOW_MS; a finger that stopped for
// STILL_MS before lifting releases at rest
const VELOCITY_WINDOW_MS = 100
const STILL_MS = 60
// A native scroll (trackpad, wheel) has come to rest once no scroll event has fired for this long
const SETTLE_MS = 150

interface Glide {
  fromX: number
  toX: number
  to: number
  start: number
  duration: number
  frame: number
}

interface Drag {
  pointerId: number
  startX: number
  startScroll: number
  from: number
  dragging: boolean
  samples: { t: number; x: number }[]
}

const ARROWS: Partial<Record<string, 1 | -1>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
}

const reducedMotion = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches

// Drives a scroll-snap row whose slides repeat `copies` times, so it can run on forever both ways.
// The row rests in the middle copy: whenever it comes to rest elsewhere it jumps by whole copies, which
// shows the same slides, so the jump can't be seen.
// Trackpads, wheels and keyboard scrolling stay native. Touch is driven here, because iOS gives any
// scroller with snap points its fast deceleration, which stops a flick after about one slide: a release
// glides as far as the page itself would, then lands on the slide nearest to that point
const driveCarousel = (
  track: HTMLElement,
  count: number,
  copies: number,
  onActive: (item: number) => void,
  onSettle: (item: number) => void
) => {
  const slides = track.children
  // The scroll position that centres slide 0, and the distance from one slide to the next
  let base = 0
  let pitch = 1
  // The slide last seen at the centre, so a resize keeps it there even if the browser re-snapped first
  let centred = homeIndex(0, count, copies)
  let glide: Glide | null = null
  let drag: Drag | null = null
  let settleTimer = 0
  let suppressClick = false
  let lastSettled = 0

  const item = (index: number) => ((index % count) + count) % count
  const xOf = (index: number) => base + index * pitch
  const position = () => (track.scrollLeft - base) / pitch
  const nearest = () => (glide ? glide.to : Math.round(position()))

  const measure = () => {
    if (slides.length === 0) {
      return
    }
    const [first, second] = Array.from(
      { length: Math.min(2, slides.length) },
      (_, index) => slides[index].getBoundingClientRect()
    )
    const { left } = track.getBoundingClientRect()
    base =
      first.left -
      left +
      track.scrollLeft +
      first.width / 2 -
      track.clientWidth / 2
    // Centres, not edges: an off-centre slide is scaled about its centre
    pitch =
      slides.length > 1
        ? second.left + second.width / 2 - (first.left + first.width / 2)
        : 1
  }

  const jump = (x: number) => {
    track.scrollLeft = x
  }

  const snap = (on: boolean) => {
    track.style.scrollSnapType = on ? '' : 'none'
  }

  // Move the row by whole copies so it rests in the middle one. Only called while nothing native is
  // scrolling it: setting scrollLeft would stop a trackpad's momentum
  const recentre = () => {
    const index = nearest()
    const moved = homeIndex(index, count, copies) - index
    if (moved === 0) {
      return
    }
    jump(track.scrollLeft + moved * pitch)
    if (glide) {
      glide.fromX += moved * pitch
      glide.toX += moved * pitch
      glide.to += moved
    }
  }

  const settle = () => {
    recentre()
    const now = item(Math.round(position()))
    if (now !== lastSettled) {
      lastSettled = now
      onSettle(now)
    }
  }

  const stopGlide = () => {
    if (glide) {
      cancelAnimationFrame(glide.frame)
      glide = null
    }
  }

  const glideTo = (to: number, duration: number) => {
    stopGlide()
    const toX = xOf(to)
    if (reducedMotion()) {
      jump(toX)
      snap(true)
      settle()
      return
    }
    snap(false)
    const current: Glide = {
      duration,
      frame: 0,
      fromX: track.scrollLeft,
      start: performance.now(),
      to,
      toX,
    }
    const tick = (now: number) => {
      const t = Math.min(1, (now - current.start) / current.duration)
      jump(current.fromX + (current.toX - current.fromX) * easeOutCubic(t))
      if (t < 1) {
        current.frame = requestAnimationFrame(tick)
        return
      }
      glide = null
      snap(true)
      settle()
    }
    glide = current
    current.frame = requestAnimationFrame(tick)
  }

  const step = (direction: 1 | -1) => {
    recentre()
    glideTo(nearest() + direction, STEP_MS)
  }

  const onScroll = () => {
    centred = Math.round(position())
    onActive(item(centred))
    window.clearTimeout(settleTimer)
    if (!glide && !drag) {
      settleTimer = window.setTimeout(settle, SETTLE_MS)
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' || drag) {
      return
    }
    suppressClick = false
    window.clearTimeout(settleTimer)
    const caught = glide !== null
    stopGlide()
    recentre()
    drag = {
      dragging: caught,
      from: Math.round(position()),
      pointerId: event.pointerId,
      samples: [],
      startScroll: track.scrollLeft,
      startX: event.clientX,
    }
    if (caught) {
      snap(false)
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) {
      return
    }
    const dx = event.clientX - drag.startX
    if (!drag.dragging) {
      if (Math.abs(dx) < DRAG_SLOP_PX) {
        return
      }
      drag.dragging = true
      drag.startX = event.clientX
      drag.startScroll = track.scrollLeft
      snap(false)
    }
    jump(drag.startScroll - (event.clientX - drag.startX))
    const t = event.timeStamp
    drag.samples.push({ t, x: event.clientX })
    while (
      drag.samples.length > 2 &&
      t - drag.samples[0].t > VELOCITY_WINDOW_MS
    ) {
      drag.samples.shift()
    }
  }

  const release = (event: PointerEvent, cancelled: boolean) => {
    if (drag?.pointerId !== event.pointerId) {
      return
    }
    const { dragging, from, samples } = drag
    drag = null
    if (!dragging) {
      return
    }
    suppressClick = true
    const [first] = samples
    const last = samples.at(-1)
    // px/ms in scroll direction: the finger moving left scrolls the row right
    const velocityPx =
      cancelled ||
      last === undefined ||
      last.t === first.t ||
      event.timeStamp - last.t > STILL_MS
        ? 0
        : -(last.x - first.x) / (last.t - first.t)
    const to = releaseTarget({
      from,
      maxTravel: Math.max(0, ((copies - 1) / 2) * count - 1),
      momentum: !reducedMotion(),
      position: position(),
      velocity: velocityPx / pitch,
    })
    glideTo(to, glideMs(xOf(to) - track.scrollLeft, velocityPx))
  }
  const onPointerUp = (event: PointerEvent) => {
    release(event, false)
  }
  const onPointerCancel = (event: PointerEvent) => {
    release(event, true)
  }

  // A drag that ends over a slide's link must not open it
  const onClick = (event: MouseEvent) => {
    if (suppressClick) {
      suppressClick = false
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return
    }
    const direction = ARROWS[event.key]
    if (direction) {
      event.preventDefault()
      step(direction)
    }
  }

  // Keep the same slide centred when the row changes size (rotation, window resize)
  const observer = new ResizeObserver(() => {
    const index = glide ? glide.to : centred
    stopGlide()
    measure()
    jump(xOf(index))
    snap(true)
    // A jump to where the row already is fires no scroll event
    centred = index
    onActive(item(index))
  })

  measure()
  jump(xOf(homeIndex(0, count, copies)))
  observer.observe(track)
  track.addEventListener('scroll', onScroll, { passive: true })
  track.addEventListener('pointerdown', onPointerDown)
  track.addEventListener('pointermove', onPointerMove)
  track.addEventListener('pointerup', onPointerUp)
  track.addEventListener('pointercancel', onPointerCancel)
  track.addEventListener('click', onClick, { capture: true })
  track.addEventListener('keydown', onKeyDown)
  const stop = () => {
    stopGlide()
    window.clearTimeout(settleTimer)
    observer.disconnect()
    track.removeEventListener('scroll', onScroll)
    track.removeEventListener('pointerdown', onPointerDown)
    track.removeEventListener('pointermove', onPointerMove)
    track.removeEventListener('pointerup', onPointerUp)
    track.removeEventListener('pointercancel', onPointerCancel)
    track.removeEventListener('click', onClick, { capture: true })
    track.removeEventListener('keydown', onKeyDown)
  }
  return { step, stop }
}

export const useLoopingCarousel = (
  track: HTMLElement | null,
  count: number,
  copies: number
) => {
  // The slide nearest the centre, as an index into the list (the same for every copy of it)
  const [active, setActive] = useState(0)
  // The slide the row last came to rest on; null until it first moves, so nothing is announced on load
  const [settled, setSettled] = useState<number | null>(null)
  const stepRef = useRef<((direction: 1 | -1) => void) | null>(null)

  useLayoutEffect(() => {
    const run = (row: HTMLElement) => {
      const carousel = driveCarousel(row, count, copies, setActive, setSettled)
      stepRef.current = carousel.step
      return () => {
        stepRef.current = null
        carousel.stop()
      }
    }
    return track && count > 0 ? run(track) : undefined
  }, [track, count, copies])

  const step = useCallback((direction: 1 | -1) => {
    stepRef.current?.(direction)
  }, [])

  return { active, settled, step }
}
