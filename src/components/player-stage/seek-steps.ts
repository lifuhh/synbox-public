// Holding an arrow key jumps further the longer it is held, as YouTube and Twitch do: the first jumps of a
// hold are 5 s, then 10 s, then 30 s
const HOLD_RAMP = [
  { fromJump: 0, seconds: 5 },
  { fromJump: 4, seconds: 10 },
  { fromJump: 8, seconds: 30 },
] as const
// A held key repeats every ~30-90 ms depending on the OS; jumps come at most this often
export const HOLD_JUMP_MS = 200

export const holdStep = (jump: number): number =>
  HOLD_RAMP.findLast((stage) => jump >= stage.fromJump)?.seconds ??
  HOLD_RAMP[0].seconds

// A seek lands no later than the end guard, so YouTube never reaches ENDED and shows its suggested videos.
// Before the duration is known (0) only the start is enforced
export const clampSeek = (
  target: number,
  duration: number,
  endGuardSec: number
): number =>
  Math.max(0, duration > 0 ? Math.min(target, duration - endGuardSec) : target)
