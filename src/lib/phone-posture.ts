// How a phone is held, from gravity in the device's own axes (DeviceMotionEvent.accelerationIncludingGravity: x
// across the screen, y up it), whatever the screen shows. Tilted between the two, or lying flat, it is neither,
// so a phone wobbling around 45 degrees never flips between them
export type PhonePosture = 'upright' | 'sideways'

// Gravity in the screen's plane under this (m/s², of 9.81) means the phone lies too flat to tell
const MIN_IN_PLANE = 5
// Within 30 degrees of standing on its bottom edge (either end) is upright, within 30 of lying on a side edge
// is sideways
const UPRIGHT_MAX_DEG = 30
const SIDEWAYS_MIN_DEG = 60

export const phonePosture = (
  x: number | null | undefined,
  y: number | null | undefined
): PhonePosture | null => {
  if (typeof x !== 'number' || typeof y !== 'number') {
    return null
  }
  if (Math.hypot(x, y) < MIN_IN_PLANE) {
    return null
  }
  // 0 with gravity along the screen's long side, 90 along its short side
  const tilt = (Math.atan2(Math.abs(x), Math.abs(y)) * 180) / Math.PI
  if (tilt <= UPRIGHT_MAX_DEG) {
    return 'upright'
  }
  return tilt >= SIDEWAYS_MIN_DEG ? 'sideways' : null
}
