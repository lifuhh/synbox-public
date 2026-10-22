// Distribution-free statistics for small samples: medians and a two-sided Mann–Whitney U test, with
// Holm's correction across the gated metrics of one run.

export const median = (xs: number[]): number => {
  const s = [...xs].toSorted((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export const cv = (xs: number[]): number => {
  if (xs.length < 2) {
    return 0
  }
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  if (mean === 0) {
    return 0
  }
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(variance) / Math.abs(mean)
}

// Abramowitz–Stegun 7.1.26; error under 1.5e-7, plenty for a p-value
const erf = (x: number): number => {
  const sign = x < 0 ? -1 : 1
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x)
  return sign * y
}

const normalTwoSided = (z: number): number => 1 - erf(Math.abs(z) / Math.SQRT2)

/** Exact two-sided p by enumerating rank sums; used when both samples are small (C(n, k) ≤ 200k) */
const exactP = (ranks: number[], k: number, observed: number): number => {
  const mean = (k * (ranks.length + 1)) / 2
  const far = Math.abs(observed - mean) - 1e-9
  let hits = 0
  let total = 0
  const walk = (start: number, left: number, sum: number) => {
    if (left === 0) {
      total += 1
      if (Math.abs(sum - mean) >= far) {
        hits += 1
      }
      return
    }
    for (let i = start; i <= ranks.length - left; i += 1) {
      walk(i + 1, left - 1, sum + ranks[i])
    }
  }
  walk(0, k, 0)
  return hits / total
}

export const choose = (n: number, k: number): number => {
  let r = 1
  for (let i = 1; i <= k; i += 1) {
    r = (r * (n - k + i)) / i
  }
  return r
}

/** Two-sided Mann–Whitney U p-value for "a and b come from the same distribution" (ties get mid-ranks) */
export const mannWhitney = (a: number[], b: number[]): number => {
  const all = [
    ...a.map((v) => ({ g: 0, v })),
    ...b.map((v) => ({ g: 1, v })),
  ].toSorted((x, y) => x.v - y.v)
  const ranks = Array.from({ length: all.length }, () => 0)
  let tieTerm = 0
  for (let i = 0; i < all.length;) {
    let j = i
    while (j + 1 < all.length && all[j + 1].v === all[i].v) {
      j += 1
    }
    const t = j - i + 1
    tieTerm += t ** 3 - t
    for (let k = i; k <= j; k += 1) {
      ranks[k] = (i + j) / 2 + 1
    }
    i = j + 1
  }
  const n1 = a.length
  const n2 = b.length
  let rankSumA = 0
  for (const [i, r] of ranks.entries()) {
    if (all[i].g === 0) {
      rankSumA += r
    }
  }
  if (choose(n1 + n2, Math.min(n1, n2)) <= 200_000) {
    // Rank sums of the smaller group, enumerated over every split
    const small =
      n1 <= n2 ? rankSumA : ((n1 + n2) * (n1 + n2 + 1)) / 2 - rankSumA
    return exactP(ranks, Math.min(n1, n2), small)
  }
  const u = rankSumA - (n1 * (n1 + 1)) / 2
  const n = n1 + n2
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1))))
  if (sigma === 0) {
    return 1
  }
  const z = (u - (n1 * n2) / 2 - Math.sign(u - (n1 * n2) / 2) * 0.5) / sigma
  return normalTwoSided(z)
}

/** Holm–Bonferroni: adjusted p-values in the input order */
export const holm = (ps: number[]): number[] => {
  const order = ps.map((p, i) => ({ i, p })).toSorted((x, y) => x.p - y.p)
  const out = Array.from({ length: ps.length }, () => 1)
  let running = 0
  for (const [rank, { i, p }] of order.entries()) {
    running = Math.max(running, Math.min(1, p * (ps.length - rank)))
    out[i] = running
  }
  return out
}
