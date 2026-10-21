import { describe, expect, test } from 'vite-plus/test'

import { holm, mannWhitney } from './stats'
import { compareMetrics } from './verdict'

describe('mannWhitney', () => {
  test('two fully separated samples of 5 give the exact two-sided minimum, 2 / C(10, 5)', () => {
    expect(mannWhitney([1, 2, 3, 4, 5], [6, 7, 8, 9, 10])).toBeCloseTo(
      2 / 252,
      6
    )
  })

  test('identical samples, ties included, are not different', () => {
    expect(mannWhitney([5, 5, 5, 5], [5, 5, 5, 5])).toBe(1)
  })

  test('large samples use the normal approximation and still find a clear shift', () => {
    const a = Array.from({ length: 40 }, (_, i) => 100 + (i % 7))
    const b = a.map((v) => v + 10)
    expect(mannWhitney(a, b)).toBeLessThan(1e-6)
  })
})

describe('holm', () => {
  test('multiplies by the remaining family size and keeps adjusted p-values monotone, in input order', () => {
    expect(holm([0.01, 0.04, 0.03])).toEqual([0.03, 0.06, 0.06])
  })
})

describe('compareMetrics', () => {
  const ms = {
    better: 'lower',
    floor: 30,
    gate: true,
    key: 'loadMs',
    pct: 0.1,
    unit: 'ms',
  } as const

  test('a 300 ms slowdown on 10 baseline vs 5 candidate samples is a regression', () => {
    const base = [500, 510, 495, 505, 498, 502, 507, 493, 499, 501]
    const [r] = compareMetrics(
      [ms],
      { loadMs: base },
      { loadMs: [800, 805, 798, 810, 795] }
    )
    expect(r.verdict).toBe('regressed')
  })

  test('a shift smaller than the threshold is unchanged however consistent it is', () => {
    const base = [500, 510, 495, 505, 498, 502, 507, 493, 499, 501]
    const [r] = compareMetrics(
      [ms],
      { loadMs: base },
      { loadMs: base.map((v) => v + 20) }
    )
    expect(r.verdict).toBe('unchanged')
  })

  test('5 against 5 across 14 gated metrics is flagged underpowered instead of silently passing', () => {
    const specs = Array.from({ length: 14 }, (_, i) => ({
      ...ms,
      key: `m${i}`,
    }))
    const base = Object.fromEntries(
      specs.map((s) => [s.key, [500, 510, 495, 505, 498]])
    )
    const cand = Object.fromEntries(
      specs.map((s) => [s.key, [800, 805, 798, 810, 795]])
    )
    const rows = compareMetrics(specs, base, cand)
    expect(
      rows.every((r) => r.underpowered && r.verdict === 'inconclusive')
    ).toBe(true)
  })
})
