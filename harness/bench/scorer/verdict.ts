// Turns two sides' samples into verdicts for `trend`. This file and stats.ts are the evaluator: a branch that changes
// them together with app code fails `check` (see gate.ts), so a change can't move its own goalposts.

import type { MetricResult, MetricSpec, MetricVerdict } from '../types'
import { choose, holm, mannWhitney, median } from './stats'

export const ALPHA = 0.05

const threshold = (spec: MetricSpec, ref: number): number =>
  Math.max(spec.floor, spec.pct * Math.abs(ref))

/** Positive when the candidate is worse, in the metric's unit */
const worseBy = (spec: MetricSpec, ref: number, cand: number): number =>
  spec.better === 'lower' ? cand - ref : ref - cand

/**
 * Mann–Whitney U per metric, Holm-corrected across the gated metrics, and a change must exceed
 * max(floor, pct × reference) to count. A metric whose sample sizes can't reach significance after correction is
 * inconclusive whatever it shows: an underpowered "unchanged" is not a pass.
 */
export const compareMetrics = (
  specs: MetricSpec[],
  ref: Record<string, number[]>,
  cand: Record<string, number[]>
): MetricResult[] => {
  const rows = specs
    .filter(
      (spec) =>
        (cand[spec.key]?.length ?? 0) > 0 && (ref[spec.key]?.length ?? 0) > 0
    )
    .map((spec) => {
      const c = cand[spec.key]
      const r = ref[spec.key]
      return { c, r, rawP: mannWhitney(r, c), spec }
    })
  const gatedIdx = rows.flatMap((row, i) => (row.spec.gate ? [i] : []))
  const adjusted = holm(gatedIdx.map((i) => rows[i].rawP))
  const adj = new Map(gatedIdx.map((i, k) => [i, adjusted[k]]))
  // The most extreme split of two samples gives the smallest p a rank test can ever report; Holm multiplies the
  // smallest p by the family size. If even that can't get under ALPHA, a real regression would read "unchanged"
  const underpowered = (nr: number, nc: number) =>
    (2 / choose(nr + nc, Math.min(nr, nc))) * Math.max(1, gatedIdx.length) >=
    ALPHA

  return rows.map(({ spec, r, c, rawP }, i): MetricResult => {
    const reference = median(r)
    const candidate = median(c)
    const t = threshold(spec, reference)
    const worse = worseBy(spec, reference, candidate)
    const p = adj.get(i) ?? rawP
    const weak = underpowered(r.length, c.length)
    let verdict: MetricVerdict
    if (weak) {
      verdict = 'inconclusive'
    } else if (Math.abs(worse) < t) {
      verdict = 'unchanged'
    } else if (p < ALPHA) {
      verdict = worse > 0 ? 'regressed' : 'improved'
    } else {
      verdict = 'inconclusive'
    }
    return {
      candidate,
      delta: candidate - reference,
      key: spec.key,
      nCandidate: c.length,
      nReference: r.length,
      p,
      reference,
      spec,
      threshold: t,
      underpowered: weak,
      verdict,
    }
  })
}
