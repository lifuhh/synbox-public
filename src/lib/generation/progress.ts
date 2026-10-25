import type { Phase, StageId, Step } from './plan'
import { stageIndex, STAGES } from './plan'

// How a stage's bar moves. A real fraction from the backend is the floor; between reports, and for stages
// that report nothing, the bar eases from that floor towards CAP of what is left, covering 80 % of the way
// in the stage's expected time (Harrison et al., "Faster Progress Bars", CHI 2010: fast early, then slow).
// The value is recomputed from the run on every frame, and reports only ever raise the floor, so a bar
// never moves backwards.
export const CAP = 0.95
// The overall percentage stops here until the job really ends
export const OVERALL_CAP = 0.99
// A reported fraction fills at most this much of its stage's bar. Stages keep working after their last
// report (separation writes and uploads the vocals), and a bar that arrived at 97 % sat on 99 % through all
// of it; the rest now eases in like an unreported stage
export const MEASURED_SHARE = 0.9
const EASE_K = Math.log(5)
// The share of its expected time a stage takes to cover that 80 %. The song check is short and its time
// varies little (3.5–7.7 s in production), so it goes fast from the start: about 85 % by half its expected
// time and over 90 % by the time it usually ends, so the last stretch is a short run to full
const PACE: Partial<Record<StageId, number>> = { check: 0.4 }
// A finished stage's bar runs from where it was to full over this long, instead of jumping there
export const FINISH_MS = 400
// A stage opened when its request went out, before the backend began it, only creeps this far: the request
// may wait seconds (a cold start, the embed check, another song holding YouTube) and a bar that raced to
// 90 % there sat at the top for the whole real stage
export const PENDING_CAP = 0.1

export interface StageRun {
  label: string
  startedAt: number
  expectedS: number
  pace: number
  // The floor: the latest real fraction, or what the bar showed when it arrived, whichever is higher. Once
  // the stage is done, what the bar showed when it closed
  base: number
  baseAt: number
  reported: boolean
  // The backend began it. Until then the bar creeps towards PENDING_CAP
  confirmed: boolean
  doneAt: number | null
  // Song Check after the button's own check passed (openQuickCheck): it keeps its own short clock, and the
  // backend's reports for it are not applied
  quick?: boolean
}

export type Runs = Partial<Record<StageId, StageRun>>

const spec = (id: StageId) => STAGES[stageIndex(id)]

export const stageValue = (run: StageRun | undefined, now: number): number => {
  if (!run) {
    return 0
  }
  if (run.doneAt !== null) {
    const t = Math.min(Math.max(now - run.doneAt, 0) / FINISH_MS, 1)
    return run.base + (1 - run.base) * (1 - (1 - t) ** 3)
  }
  const remainingS = Math.max(run.expectedS * run.pace * (1 - run.base), 1)
  const elapsedS = Math.max(now - run.baseAt, 0) / 1000
  const eased = 1 - Math.exp((-EASE_K * elapsedS) / remainingS)
  return run.base + (1 - run.base) * (run.confirmed ? CAP : PENDING_CAP) * eased
}

// Keeps what the bar shows now as the floor, so changing how it moves from here can't move it back
const rebase = (run: StageRun, now: number): StageRun => ({
  ...run,
  base: stageValue(run, now),
  baseAt: now,
})

const close = (run: StageRun, now: number): StageRun => ({
  ...rebase(run, now),
  doneAt: now,
})

// Closes every stage before `index`. One that never opened was skipped (a cached step) and counts as done.
const finishBefore = (runs: Runs, index: number, now: number): Runs => {
  const next = { ...runs }
  for (const stage of STAGES.slice(0, index)) {
    const run = next[stage.id]
    if (!run) {
      next[stage.id] = {
        base: 1,
        baseAt: now,
        confirmed: true,
        doneAt: now,
        expectedS: 0,
        label: stage.label,
        pace: 1,
        reported: false,
        startedAt: now,
      }
    } else if (run.doneAt === null) {
      next[stage.id] = close(run, now)
    }
  }
  return next
}

interface StageUpdate {
  expectedS?: number
  label?: string
}

const openStage = (
  runs: Runs,
  id: StageId,
  now: number,
  update: StageUpdate,
  confirmed: boolean
): Runs => {
  const next = finishBefore(runs, stageIndex(id), now)
  const run = next[id]
  if (run) {
    const expectedS = update.expectedS ?? run.expectedS
    const label = update.label ?? run.label
    const changes =
      run.doneAt === null &&
      ((confirmed && !run.confirmed) || expectedS !== run.expectedS)
    next[id] = {
      ...(changes ? rebase(run, now) : run),
      confirmed: run.confirmed || confirmed,
      expectedS,
      label,
    }
    return next
  }
  next[id] = {
    base: 0,
    baseAt: now,
    confirmed,
    doneAt: null,
    expectedS: update.expectedS ?? spec(id).weight,
    label: update.label ?? spec(id).label,
    pace: PACE[id] ?? 1,
    reported: false,
    startedAt: now,
  }
  return next
}

// The backend began a stage: opens it and closes every stage before it.
// Opening a stage that is already open keeps its clock, so a stream that replays from the start after a
// reconnect changes nothing it already showed. A new estimate (the backend's, arriving after the request
// sat in line) changes how the bar moves from where it is, never where it is.
export const beginStage = (
  runs: Runs,
  id: StageId,
  now: number,
  update: StageUpdate = {}
): Runs => openStage(runs, id, now, update, true)

export const reportFraction = (
  runs: Runs,
  id: StageId,
  fraction: number,
  now: number
): Runs => {
  const next = runs[id] ? runs : beginStage(runs, id, now)
  const run = next[id]
  if (!run || run.doneAt !== null) {
    return next
  }
  if (fraction >= 1) {
    return { ...next, [id]: close(run, now) }
  }
  return {
    ...next,
    [id]: {
      ...run,
      base: Math.max(MEASURED_SHARE * fraction, stageValue(run, now)),
      baseAt: now,
      confirmed: true,
      reported: true,
    },
  }
}

// One past the phase's last stage
const phaseEnd = (phase: Phase) => {
  let end = 0
  for (const [index, stage] of STAGES.entries()) {
    if (stage.phase === phase) {
      end = index + 1
    }
  }
  return end
}

// A phase's stream ended well: every stage up to the phase's last is done
export const completePhase = (runs: Runs, phase: Phase, now: number): Runs =>
  finishBefore(runs, phaseEnd(phase), now)

// The panel's first step, once the Generate Lyrics button's check passed (preflight.ts): it fills over `ms`,
// QUICK_CHECK_MS apart, and closes then (closeQuickCheck), however long the backend's own check takes. Song
// Analysis then shows as begun, creeping until the backend reports it
export const QUICK_CHECK_MS = { max: 2000, min: 1300 } as const
// The share of `ms` the bar takes to cover 80 % of its way: about 88 % full when the step closes
const QUICK_PACE = 0.6

export const openQuickCheck = (runs: Runs, now: number, ms: number): Runs => ({
  ...runs,
  check: {
    base: 0,
    baseAt: now,
    confirmed: true,
    doneAt: null,
    expectedS: ms / 1000,
    label: spec('check').label,
    pace: QUICK_PACE,
    quick: true,
    reported: false,
    startedAt: now,
  },
})

export const closeQuickCheck = (runs: Runs, now: number): Runs => {
  const { check } = runs
  if (check?.doneAt !== null || check.quick !== true) {
    return runs
  }
  const next: Runs = { ...runs, check: close(check, now) }
  return next.download ? next : openStage(next, 'download', now, {}, false)
}

// The first stage of a phase whose request just went out, so its bar moves before the backend's first report
export const startPhase = (runs: Runs, phase: Phase, now: number): Runs => {
  const first = STAGES.find((stage) => stage.phase === phase)
  return first && !runs[first.id]
    ? openStage(runs, first.id, now, {}, false)
    : runs
}

const weighted = (runs: Runs, ids: readonly StageId[], now: number) => {
  let total = 0
  let done = 0
  for (const id of ids) {
    const { weight } = spec(id)
    total += weight
    done += weight * stageValue(runs[id], now)
  }
  return total === 0 ? 0 : done / total
}

export const overallValue = (runs: Runs, now: number, complete: boolean) =>
  complete
    ? 1
    : Math.min(
        weighted(
          runs,
          STAGES.map((stage) => stage.id),
          now
        ),
        OVERALL_CAP
      )

export type StepState = 'pending' | 'active' | 'done'

export interface StepView {
  fraction: number
  state: StepState
  // The running stage's label, while the step is active
  detail: string | null
  // The running stage reports real fractions, rather than easing on its expected time
  measured: boolean
}

export const stepView = (runs: Runs, step: Step, now: number): StepView => {
  const ids: readonly StageId[] = step.stages
  const stageRuns = ids.map((id) => runs[id])
  const fraction = weighted(runs, step.stages, now)
  if (stageRuns.every((run) => run !== undefined && run.doneAt !== null)) {
    return {
      detail: null,
      fraction,
      measured: false,
      state: 'done',
    }
  }
  const open = stageRuns.find(
    (run): run is StageRun => run !== undefined && run.doneAt === null
  )
  if (open === undefined) {
    // Between two of its stages (one closed, the next not reported yet) the step is still running
    const next = ids.find((id) => runs[id] === undefined)
    if (stageRuns.some((run) => run !== undefined) && next !== undefined) {
      return {
        detail: spec(next).label,
        fraction,
        measured: false,
        state: 'active',
      }
    }
    return {
      detail: null,
      fraction,
      measured: false,
      state: 'pending',
    }
  }
  return {
    detail: open.label,
    fraction,
    measured: open.reported,
    state: 'active',
  }
}

// A rough time left: what each unfinished stage still needs at its expected pace
export const remainingSeconds = (runs: Runs, now: number) => {
  let sum = 0
  for (const stage of STAGES) {
    const run = runs[stage.id]
    if (!run) {
      sum += stage.weight
    } else if (run.doneAt === null) {
      const leftByClock = run.expectedS - (now - run.startedAt) / 1000
      const leftByValue = run.expectedS * (1 - stageValue(run, now))
      sum += Math.max(leftByClock, leftByValue, 0)
    }
  }
  return sum
}
