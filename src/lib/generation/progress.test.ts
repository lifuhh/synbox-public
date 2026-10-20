import { describe, expect, test } from 'vite-plus/test'

import { STEPS } from './plan'
import {
  beginStage,
  CAP,
  completePhase,
  MEASURED_SHARE,
  OVERALL_CAP,
  overallValue,
  reportFraction,
  stageValue,
  stepView,
} from './progress'

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
    expect(stepView(runs, STEPS[0], 5 * S).state).toBe('done')
    expect(stepView(runs, STEPS[1], 5 * S)).toMatchObject({
      fraction: 1,
      state: 'done',
    })
    expect(stepView(runs, STEPS[2], 5 * S).state).toBe('active')
    expect(stepView(runs, STEPS[3], 5 * S).state).toBe('pending')
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
  test('stays active between two of its stages', () => {
    let runs = beginStage({}, 'download', 0)
    runs = reportFraction(runs, 'download', 1, 2 * S)
    expect(stepView(runs, STEPS[0], 2 * S)).toMatchObject({
      detail: "Checking it's a Japanese song",
      state: 'active',
    })
  })
})
