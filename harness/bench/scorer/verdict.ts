// Turns samples into verdicts. This file and stats.ts are the evaluator: a branch that changes them together with
// app code fails the gate (see gate.ts), so a change can't move its own goalposts.

import type { MetricResult, MetricSpec, MetricVerdict, Status } from '../types'
import { choose, holm, mannWhitney, median } from './stats'

export const ALPHA = 0.05

const threshold = (spec: MetricSpec, base: number): number =>
  Math.max(spec.floor, spec.pct * Math.abs(base))

/** Positive when the candidate is worse, in the metric's unit */
const worseBy = (spec: MetricSpec, base: number, cand: number): number =>
  spec.better === 'lower' ? cand - base : base - cand

export const compareMetrics = (
  specs: MetricSpec[],
  base: Record<string, number[]>,
  cand: Record<string, number[]>
): MetricResult[] => {
  const rows = specs
    .filter((spec) => (cand[spec.key]?.length ?? 0) > 0)
    .map((spec) => {
      const c = cand[spec.key]
      const b = base[spec.key] ?? []
      const rawP =
        spec.exact === true || b.length === 0 ? null : mannWhitney(b, c)
      return { b, c, rawP, spec }
    })
  // Holm across the gated statistical metrics of this comparison, so more metrics don't mean more false alarms
  const gatedIdx = rows.flatMap((r, i) =>
    r.spec.gate && r.rawP !== null ? [i] : []
  )
  const adjusted = holm(gatedIdx.map((i) => rows[i].rawP ?? 1))
  const adj = new Map(gatedIdx.map((i, k) => [i, adjusted[k]]))
  // The most extreme split of two samples gives the smallest p a rank test can ever report; Holm multiplies the
  // smallest p by the family size. If even that can't get under ALPHA, a real regression would read "unchanged"
  const underpowered = (nb: number, nc: number) =>
    (2 / choose(nb + nc, Math.min(nb, nc))) * Math.max(1, gatedIdx.length) >=
    ALPHA

  return rows.map(({ spec, b, c, rawP }, i): MetricResult => {
    const candidate = median(c)
    if (b.length === 0) {
      return {
        baseline: null,
        candidate,
        delta: null,
        key: spec.key,
        nBase: 0,
        nCand: c.length,
        p: null,
        spec,
        threshold: null,
        underpowered: false,
        verdict: 'new',
      }
    }
    const baseline = median(b)
    const t = threshold(spec, baseline)
    const worse = worseBy(spec, baseline, candidate)
    const p = adj.get(i) ?? rawP
    let verdict: MetricVerdict
    if (spec.exact === true) {
      if (worse >= t) {
        verdict = 'regressed'
      } else if (worse <= -t) {
        verdict = 'improved'
      } else {
        verdict = 'unchanged'
      }
    } else if (Math.abs(worse) < t) {
      verdict = 'unchanged'
    } else if (p !== null && p < ALPHA) {
      verdict = worse > 0 ? 'regressed' : 'improved'
    } else {
      verdict = 'inconclusive'
    }
    return {
      baseline,
      candidate,
      delta: candidate - baseline,
      key: spec.key,
      nBase: b.length,
      nCand: c.length,
      p,
      spec,
      threshold: t,
      underpowered:
        spec.exact !== true && spec.gate && underpowered(b.length, c.length),
      verdict,
    }
  })
}

/** A gated regression fails; a gated metric drifting the wrong way without proof warns */
export const statusOf = (metrics: MetricResult[]): Status => {
  const gated = metrics.filter((m) => m.spec.gate)
  if (gated.some((m) => m.verdict === 'regressed')) {
    return 'fail'
  }
  const drifting = gated.some(
    (m) =>
      m.verdict === 'inconclusive' &&
      m.baseline !== null &&
      worseBy(m.spec, m.baseline, m.candidate) > 0
  )
  return drifting ? 'warn' : 'pass'
}

/**
 * The hill-climb objective: the geometric mean, over gated metrics, of how many times better the candidate is
 * than the baseline (1 = no change). A geometric mean rewards gains everywhere; a metric that gets worse pulls it
 * down multiplicatively instead of being averaged away. Exact count metrics at 0 are left out (no ratio exists).
 */
export const score = (metrics: MetricResult[]): number | null => {
  const ratios = metrics
    .filter((m) => m.spec.gate && m.baseline !== null)
    .flatMap((m) => {
      const b = m.baseline ?? 0
      const c = m.candidate
      if (b <= 0 || c <= 0) {
        return []
      }
      return [m.spec.better === 'lower' ? b / c : c / b]
    })
  if (ratios.length === 0) {
    return null
  }
  return Math.exp(ratios.reduce((s, r) => s + Math.log(r), 0) / ratios.length)
}
