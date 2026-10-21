// Positions are in slides: 2.5 is halfway between the third and fourth slide of the whole row, clones
// included. A looping row repeats the list `copies` times and rests in the middle copy

// How far a release glides on, per px/ms of finger speed: iOS's normal scroll deceleration (0.998 per
// ms) comes to rest after v * 0.998 / 0.002 ms-px, so a flick travels as far as it would on the page
const GLIDE_PER_VELOCITY = 499
// A drag this far (in slides) commits to the next slide even when released slowly
const COMMIT_DRAG = 0.1
const GLIDE_MIN_MS = 240
const GLIDE_MAX_MS = 900
// Buttons, keys and releases slower than SLOW_PX_PER_MS take this long
export const STEP_MS = 320
const SLOW_PX_PER_MS = 0.3

// Copies so that at least `buffer` slides sit on each side of the middle copy
export const loopCopies = (count: number, buffer: number) =>
  count > 1 ? 2 * Math.ceil(buffer / count) + 1 : 1

// The same slide in the middle copy
export const homeIndex = (index: number, count: number, copies: number) => {
  const item = ((index % count) + count) % count
  return ((copies - 1) / 2) * count + item
}

// Where a released drag settles: the slide nearest to where its momentum would carry it. A slow drag
// still moves one slide once it passes COMMIT_DRAG; `momentum: false` (reduced motion) settles on the
// nearest slide or the next one only
export const releaseTarget = ({
  from,
  position,
  velocity,
  maxTravel,
  momentum,
}: {
  from: number
  position: number
  velocity: number
  maxTravel: number
  momentum: boolean
}) => {
  const projected = momentum
    ? position + velocity * GLIDE_PER_VELOCITY
    : position
  let target = Math.round(projected)
  const dragged = position - from
  if (target === from && Math.abs(dragged) >= COMMIT_DRAG) {
    target = from + Math.sign(dragged)
  }
  const travel = momentum ? maxTravel : 1
  return Math.min(from + travel, Math.max(from - travel, target))
}

// A cubic ease-out starts at 3 * distance / duration: pick the duration that starts at the finger's
// speed, so the glide carries on from the release without a jolt
export const glideMs = (distancePx: number, velocityPxPerMs: number) => {
  const towards = Math.sign(distancePx) === Math.sign(velocityPxPerMs)
  const speed = towards ? Math.abs(velocityPxPerMs) : 0
  if (speed < SLOW_PX_PER_MS) {
    return STEP_MS
  }
  return Math.min(
    GLIDE_MAX_MS,
    Math.max(GLIDE_MIN_MS, (3 * Math.abs(distancePx)) / speed)
  )
}

export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
