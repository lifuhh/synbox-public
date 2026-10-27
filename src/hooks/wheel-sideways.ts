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
// One notch in the legacy wheelDelta units every engine still reports
const NOTCH = 120
// WheelEvent's delta modes, as numbers so this module also loads where WheelEvent isn't defined (tests)
const PIXEL = 0
const LINE = 1
// Float noise between deltaY and the integer wheelDeltaY the engine truncated from it
const SLACK = 0.01
// Fractions of a notch that add up to one, give or take float noise
const WHOLE = 0.999

export interface WheelSample {
  deltaMode: number
  deltaY: number
  wheelDeltaY?: number
}

/**
 * How many notches of a mouse wheel one wheel event is, or 0 for a trackpad's precise scroll, which stays native.
 *
 * Read from Chromium's, WebKit's and Gecko's source (the change log of fix/wheel-sideways-windows cites the files):
 * - Firefox reports a mouse in lines (deltaMode 1), a trackpad in pixels.
 * - In pixels, wheelDeltaY is 120 a notch for a mouse, but for a precise scroll it is deltaY truncated to an
 *   integer: once deltaY on Windows and Linux (Chromium sets the ticks to delta / 120), three times deltaY on macOS
 *   (Chromium and Safari set them to delta / 40). A Windows mouse can't land on either: its deltaY is 100 × lines
 *   to scroll / 3 a notch, so wheelDeltaY / deltaY is 3.6 / lines.
 * - Page zoom divides both by the same factor, so wheelDeltaY is no longer a multiple of 120 (96 at 125%); the
 *   ratios hold. A high-resolution wheel sends fractions of a notch (15 = an eighth); the ratios hold too.
 * - A Linux mouse reports wheelDeltaY = deltaY = 120: whole notches at that ratio count as a mouse.
 * - Safari gives a mouse the trackpad's ratio, so there a mouse stays native too.
 */
export const mouseNotches = ({
  deltaMode,
  deltaY,
  wheelDeltaY = 0,
}: WheelSample): number => {
  const legacy = Math.abs(wheelDeltaY)
  if (deltaMode !== PIXEL) {
    return legacy > 0 ? legacy / NOTCH : 1
  }
  const delta = Math.abs(deltaY)
  if (legacy === 0 || delta === 0) {
    return 0
  }
  const truncated = (times: number) =>
    legacy <= times * delta + SLACK && legacy > times * delta - 1 - SLACK
  if (truncated(3) || (truncated(1) && legacy % NOTCH !== 0)) {
    return 0
  }
  return legacy / NOTCH
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

// Pixels in one unit of deltaY: a line, or a page (Windows' "one screen at a time" wheel setting)
const unitPx = (mode: number, el: HTMLElement) => {
  if (mode === PIXEL) {
    return 1
  }
  return mode === LINE ? LINE_PX : el.clientWidth
}

type LegacyWheel = WheelEvent & { wheelDeltaY?: number }

// Turns a mouse wheel over a sideways row into sideways scrolling, as a desktop user pointing at the row expects.
// Each notch adds to where the row is headed, so fast notches are never lost to a glide still under way. At either
// end the wheel is left alone and scrolls the page, so the row never traps it. Shift-wheel and trackpads stay native
const watch = (el: HTMLElement) => {
  let target: number | null = null
  let lastAt = Number.NEGATIVE_INFINITY
  let pace = SLOW_MS
  // The pace is timed between whole notches, so the burst of small events a high-resolution wheel sends for one
  // slow notch doesn't read as a spin: notches since the last whole one, and when that was (null: none yet this run)
  let turnedSince = 0
  let wholeAt: number | null = null
  // Notches turned since the last step of a snapping row, signed: a high-resolution wheel's fractions add up to one,
  // however slowly it turns
  let carry = 0
  const onWheel = (event: WheelEvent) => {
    // deltaMode before any delta: Firefox reports a line-based wheel in pixels once a delta is read first
    const mode = event.deltaMode
    if (
      event.ctrlKey ||
      event.shiftKey ||
      event.deltaX !== 0 ||
      event.deltaY === 0
    ) {
      return
    }
    const notches = mouseNotches({
      deltaMode: mode,
      deltaY: event.deltaY,
      wheelDeltaY: (event as LegacyWheel).wheelDeltaY,
    })
    const max = el.scrollWidth - el.clientWidth
    if (notches === 0 || max <= 1) {
      return
    }
    // Half a notch or more is a whole one (page zoom scales a notch to 0.5 to 1.5); less is a high-resolution
    // wheel's fraction
    const turned = notches >= 0.5 ? Math.max(Math.round(notches), 1) : notches
    if (event.timeStamp - lastAt >= RUN_MS) {
      target = null
      pace = SLOW_MS
      turnedSince = 0
      wholeAt = null
    }
    lastAt = event.timeStamp
    turnedSince += turned
    if (turnedSince >= WHOLE) {
      if (wholeAt !== null) {
        pace = (pace + (event.timeStamp - wholeAt) / turnedSince) / 2
      }
      wholeAt = event.timeStamp
      turnedSince = 0
    }
    const from = target ?? el.scrollLeft
    const direction = Math.sign(event.deltaY)
    if (direction > 0 ? from >= max - 1 : from <= 1) {
      target = null
      carry = 0
      return
    }
    event.preventDefault()
    const pitch = snapPitch(el)
    if (pitch > 0) {
      carry += direction * turned
      if (Math.abs(carry) < WHOLE) {
        return
      }
      carry = 0
    }
    const step =
      direction *
      Math.max(Math.abs(event.deltaY) * unitPx(mode, el), pitch) *
      boost(pace)
    target = Math.min(Math.max(from + step, 0), max)
    el.scrollTo({
      behavior: reducedMotion() ? 'instant' : 'smooth',
      left: target,
    })
  }
  el.addEventListener('wheel', onWheel, { passive: false })
  return () => {
    el.removeEventListener('wheel', onWheel)
  }
}

// For a ref callback: returns its cleanup
export const wheelSideways = (el: HTMLElement | null) =>
  el ? watch(el) : undefined
