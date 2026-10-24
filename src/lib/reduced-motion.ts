// The device's Reduce Motion setting, read when it is needed (it can change while the app is open)
export const reducedMotion = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches

// A scroll the app makes itself glides, unless Reduce Motion is on: then it jumps
export const scrollMotion = (): ScrollBehavior =>
  reducedMotion() ? 'auto' : 'smooth'
