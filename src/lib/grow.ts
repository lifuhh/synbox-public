// The tap on the mini bar plays the drag to minimise backwards at one pace (use-drag-to-minimise.ts): `t` is the
// drag's own progress, 1 on the bar and 0 on the stage, eased out over GROW_MS. As Web Animations keyframes, so
// WebKit runs it on the compositor while the player page renders
export const GROW_MS = 280

// cubic-bezier(0.2, 0, 0, 1), near enough
const easeOut = (p: number) => 1 - (1 - p) ** 3

export const growT = (p: number) => 1 - easeOut(Math.min(1, Math.max(0, p)))

// Enough steps that linear pieces between them read as the curve
const STEPS = 12

export const growFrames = (at: (t: number) => Keyframe): Keyframe[] =>
  Array.from({ length: STEPS + 1 }, (_, step) => ({
    ...at(growT(step / STEPS)),
    offset: step / STEPS,
  }))

// `element` drawn along the grow that began at `startedAt` (performance.now()), joined where it has got to
export const runGrow = (
  element: Element,
  at: (t: number) => Keyframe,
  startedAt: number
) => {
  const animation = element.animate(growFrames(at), {
    duration: GROW_MS,
    easing: 'linear',
    fill: 'forwards',
  })
  animation.currentTime = Math.min(GROW_MS, performance.now() - startedAt)
  return animation
}
