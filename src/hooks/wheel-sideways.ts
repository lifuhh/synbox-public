import { reducedMotion } from '@/lib/reduced-motion'

// A spun wheel goes further per notch: notches SLOW_MS or more apart move the notch's own distance, notches FAST_MS
// apart or closer MAX_BOOST times as far, and the pace between eases in between
const SLOW_MS = 160
const FAST_MS = 40
const MAX_BOOST = 4
// A pause this long ends a run of notches: the next one starts slow, from where the row is
const RUN_MS = 300
// A line of a line-based wheel (Firefox), in pixels: three lines a notch make about Chromium's 100px
const LINE_PX = 33

type LegacyWheel = WheelEvent & { wheelDeltaY?: number }

// A mouse wheel's notch, not a trackpad's swipe (which scrolls natively both ways). Firefox reports a mouse in lines;
// Chromium and WebKit keep the legacy wheelDeltaY, a multiple of 120 a notch for a mouse and three times deltaY for
// a trackpad's precise scroll
const isNotch = (event: WheelEvent) => {
  if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
    return true
  }
  const legacy = (event as LegacyWheel).wheelDeltaY ?? 0
  return (
    legacy !== 0 &&
    legacy % 120 === 0 &&
    Math.abs(legacy) !== Math.abs(event.deltaY) * 3
  )
}

// A row that snaps to its items (the shelves) moves at least one item a notch, or it would snap back where it was
const snapPitch = (el: HTMLElement) => {
  const [first, second] = el.children
  return getComputedStyle(el).scrollSnapType.includes('mandatory') &&
    first instanceof HTMLElement &&
    second instanceof HTMLElement
    ? second.offsetLeft - first.offsetLeft
    : 0
}

const boost = (paceMs: number) =>
  1 +
  (MAX_BOOST - 1) *
    Math.min(Math.max((SLOW_MS - paceMs) / (SLOW_MS - FAST_MS), 0), 1)

// Turns a mouse wheel over a sideways row into sideways scrolling, as a desktop user pointing at the row expects.
// Each notch adds to where the row is headed, so fast notches are never lost to a glide still under way. At either
// end the wheel is left alone and scrolls the page, so the row never traps it. Shift-wheel and trackpads stay native
const watch = (el: HTMLElement) => {
  let target: number | null = null
  let lastAt = Number.NEGATIVE_INFINITY
  let pace = SLOW_MS
  const onWheel = (event: WheelEvent) => {
    if (
      event.ctrlKey ||
      event.shiftKey ||
      event.deltaX !== 0 ||
      event.deltaY === 0 ||
      !isNotch(event)
    ) {
      return
    }
    const max = el.scrollWidth - el.clientWidth
    if (max <= 1) {
      return
    }
    const gap = event.timeStamp - lastAt
    lastAt = event.timeStamp
    const running = gap < RUN_MS && target !== null
    pace = running ? (pace + gap) / 2 : SLOW_MS
    const from = running && target !== null ? target : el.scrollLeft
    const notch =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY * LINE_PX
        : event.deltaY
    const step = Math.sign(notch) * Math.max(Math.abs(notch), snapPitch(el))
    const to = Math.min(Math.max(from + step * boost(pace), 0), max)
    if (Math.abs(to - from) < 1) {
      target = null
      return
    }
    event.preventDefault()
    target = to
    el.scrollTo({ behavior: reducedMotion() ? 'instant' : 'smooth', left: to })
  }
  el.addEventListener('wheel', onWheel, { passive: false })
  return () => {
    el.removeEventListener('wheel', onWheel)
  }
}

// For a ref callback: returns its cleanup
export const wheelSideways = (el: HTMLElement | null) =>
  el ? watch(el) : undefined
