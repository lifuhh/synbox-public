import { describe, expect, test } from 'vite-plus/test'

import { STEPS } from './plan'
import {
  beginStage,
  CAP,
  completePhase,
  FINISH_MS,
  MEASURED_SHARE,
  OVERALL_CAP,
  overallValue,
  PENDING_CAP,
  reportFraction,
  stageValue,
  startPhase,
  stepView,
} from './progress'
import type { Runs } from './progress'

const S = 1000

describe('a stage with no reports', () => {
  test('runs fast early, slows after its expected time and never fills by itself', () => {
    const runs = beginStage({}, 'listen', 0, { expectedS: 30 })
    const at = (s: number) => stageValue(runs.listen, s * S)
    expect(at(10)).toBeGreaterThan(0.38)
    expect(at(30)).toBeCloseTo(0.8 * CAP, 2)
    // The second half of the expected time adds less than the first
    expect(at(30) - at(15)).toBeLessThan(at(15))
    expect(at(600)).toBeLessThan(CAP + 1e-9)
  })
})

describe('the song check', () => {
  test('is past 85 % when it usually ends, then runs to full instead of jumping', () => {
    // 3.5–7.7 s in production, against the backend's 5 s estimate
    let runs = beginStage({}, 'check', 0, { expectedS: 5 })
    expect(stageValue(runs.check, 3.5 * S)).toBeGreaterThan(0.85)
    const shown = stageValue(runs.check, 4 * S)
    runs = beginStage(runs, 'download', 4 * S)
    expect(stageValue(runs.check, 4 * S)).toBeCloseTo(shown, 9)
    let last = shown
    for (let t = 0; t <= FINISH_MS; t += 50) {
      const value = stageValue(runs.check, 4 * S + t)
      expect(value).toBeGreaterThanOrEqual(last)
      last = value
    }
    expect(last).toBe(1)
  })
})

describe('a stage the backend has not begun', () => {
  test('creeps while its request waits, and the late first report never pulls it back', () => {
    // The panel opens the check when /validate goes out; the backend's first word comes 8 s later (a cold
    // start, the embed check, a lock) with a longer estimate than the default. The check used to race to
    // 94 % before the backend began it, drop to 92 % on that word, then sit at 98-99 %
    let runs = startPhase({}, 'validate', 0)
    const shown: number[] = []
    for (let t = 0; t <= 20 * S; t += 100) {
      if (t === 8 * S) {
        runs = beginStage(runs, 'check', t, { expectedS: 12 })
        runs = reportFraction(runs, 'check', 0, t)
      }
      shown.push(stageValue(runs.check, t))
    }
    expect(Math.max(...shown.slice(0, 80))).toBeLessThanOrEqual(PENDING_CAP)
    for (const [i, value] of shown.entries()) {
      expect(value).toBeGreaterThanOrEqual(shown[i - 1] ?? 0)
    }
    // Once begun it moves on its real estimate: well along 6 s in, still short of its cap
    expect(stageValue(runs.check, 14 * S)).toBeGreaterThan(0.6)
  })

  test('every step and the overall percentage only rise through a whole job with reconnects', () => {
    // Events as a phone sees them: requests that wait, estimates that change, a reconnect that replays
    const events: [number, (runs: Runs, t: number) => Runs][] = [
      [0, (r, t) => startPhase(r, 'validate', t)],
      [3000, (r, t) => beginStage(r, 'check', t, { expectedS: 9 })],
      [6000, (r, t) => beginStage(r, 'download', t, { expectedS: 4 })],
      [7000, (r, t) => reportFraction(r, 'download', 0.5, t)],
      [9000, (r, t) => completePhase(r, 'validate', t)],
      [9000, (r, t) => startPhase(r, 'transcribe', t)],
      [20_000, (r, t) => beginStage(r, 'read', t, { expectedS: 30 })],
      [30_000, (r, t) => beginStage(r, 'separate', t, { expectedS: 40 })],
      [40_000, (r, t) => reportFraction(r, 'separate', 0.5, t)],
      // The reconnect replays the stream from the start, with the estimates of the time
      [70_000, (r, t) => beginStage(r, 'read', t, { expectedS: 8 })],
      [70_000, (r, t) => beginStage(r, 'separate', t, { expectedS: 90 })],
      [70_000, (r, t) => reportFraction(r, 'separate', 0.2, t)],
      [80_000, (r, t) => beginStage(r, 'align', t, { expectedS: 5 })],
    ]
    let runs: Runs = {}
    let last = { overall: 0, steps: STEPS.map(() => 0) }
    for (let t = 0; t <= 100_000; t += 100) {
      for (const [at, apply] of events) {
        if (at === t) {
          runs = apply(runs, t)
        }
      }
      const at = runs
      const now = {
        overall: overallValue(at, t, false),
        steps: STEPS.map((step) => stepView(at, step, t).fraction),
      }
      expect(now.overall).toBeGreaterThanOrEqual(last.overall)
      for (const [i, fraction] of now.steps.entries()) {
        expect(fraction).toBeGreaterThanOrEqual(last.steps[i])
      }
      last = now
    }
  })
})

describe('real fractions', () => {
  test('a report below what the bar already shows does not pull it back', () => {
    let runs = beginStage({}, 'separate', 0, { expectedS: 100 })
    const before = stageValue(runs.separate, 50 * S)
    runs = reportFraction(runs, 'separate', 0.1, 50 * S)
    expect(stageValue(runs.separate, 50 * S)).toBeCloseTo(before, 9)
    for (let t = 50; t < 400; t += 7) {
      expect(stageValue(runs.separate, (t + 7) * S)).toBeGreaterThanOrEqual(
        stageValue(runs.separate, t * S)
      )
    }
  })

  test('a report above it raises the bar to its share of the stage', () => {
    let runs = beginStage({}, 'download', 0, { expectedS: 10 })
    runs = reportFraction(runs, 'download', 0.6, 1 * S)
    expect(stageValue(runs.download, 1 * S)).toBeCloseTo(
      0.6 * MEASURED_SHARE,
      9
    )
  })

  test('a stage that works on after its last report does not sit at 99 %', () => {
    // Separation on a 5.5-minute song: the last segment reports 97 %, then the vocals are written and uploaded
    let runs = beginStage({}, 'separate', 0, { expectedS: 160 })
    runs = reportFraction(runs, 'separate', 0.97, 150 * S)
    expect(stageValue(runs.separate, 160 * S)).toBeLessThan(0.97)
  })
})

describe('the overall percentage', () => {
  test('a later stage finishes the ones before it, skipped ones included', () => {
    let runs = beginStage({}, 'read', 0)
    // Separation was cached, so the backend went straight to listening
    runs = beginStage(runs, 'listen', 5 * S)
    expect(runs.read?.doneAt).toBe(5 * S)
    expect(stepView(runs, STEPS[1], 5 * S).state).toBe('done')
    expect(stepView(runs, STEPS[2], 5 * S)).toMatchObject({
      fraction: 1,
      state: 'done',
    })
    expect(stepView(runs, STEPS[3], 5 * S).state).toBe('active')
    expect(stepView(runs, STEPS[4], 5 * S).state).toBe('pending')
  })

  test('a reconnect that replays the stream from the start changes nothing', () => {
    let runs = beginStage({}, 'separate', 0, { expectedS: 100 })
    runs = reportFraction(runs, 'separate', 0.5, 40 * S)
    const shown = overallValue(runs, 41 * S, false)
    runs = beginStage(runs, 'separate', 41 * S, { expectedS: 100 })
    runs = reportFraction(runs, 'separate', 0.1, 41 * S)
    expect(overallValue(runs, 41 * S, false)).toBeCloseTo(shown, 9)
    expect(runs.separate?.startedAt).toBe(0)
  })

  test('stays under 100 % until the job really ends', () => {
    let runs = beginStage({}, 'download', 0)
    for (const phase of ['validate', 'transcribe', 'translate'] as const) {
      runs = completePhase(runs, phase, 1 * S)
    }
    expect(overallValue(runs, 2 * S, false)).toBe(OVERALL_CAP)
    expect(overallValue(runs, 2 * S, true)).toBe(1)
  })
})

describe('a step', () => {
  test('the quick check clears as its own first step before the download starts', () => {
    let runs = beginStage({}, 'check', 0)
    runs = beginStage(runs, 'download', 3 * S)
    expect(stepView(runs, STEPS[0], 3 * S).state).toBe('done')
    expect(stepView(runs, STEPS[1], 3 * S).state).toBe('active')
  })

  test('stays active between two of its stages', () => {
    let runs = beginStage({}, 'download', 0)
    runs = reportFraction(runs, 'download', 1, 2 * S)
    expect(stepView(runs, STEPS[1], 2 * S)).toMatchObject({
      detail: 'Reading subtitles and song details',
      state: 'active',
    })
  })
})
