// The bench's domain. A benchmark yields samples (one value per metric per run). Exact benchmarks (sizes, layout
// counts) are checked against committed budgets; timing benchmarks are compared, side against side, by the scorer.

export type Unit = 'ms' | 'fps' | 'ratio' | 'count' | 'kb' | 'cls'
export type Better = 'lower' | 'higher'

export interface MetricSpec {
  key: string
  unit: Unit
  better: Better
  /** Smallest absolute change worth reporting */
  floor: number
  /** Smallest relative change worth reporting, as a fraction of the reference median */
  pct: number
  /** Gated metrics decide the verdict; the rest are reported */
  gate: boolean
  /** One sample per run is exact (sizes, layout counts): checked against a budget, no statistics */
  exact?: boolean
}

export type Surface =
  | { kind: 'desktop'; engine: 'chromium' }
  | {
      kind: 'phone'
      engine: 'webkit'
      orientation: 'portrait' | 'landscape'
      /** Opened from the Home Screen: the installed app's own layout (tab bar, short top bar) */
      installed?: true
    }

export interface BenchContext {
  /** Origin of the bench server for the build under test, e.g. http://localhost:4317 */
  origin: string
  /** Directory of the build under test (for size benches) */
  distDir: string
  /** Where the bench may write traces or screenshots for this run */
  artifactDir: string
  /** Discarded runs before measuring */
  warmup: number
  log: (message: string) => void
}

/** One run's numbers, plus findings that explain them */
export interface Sample {
  values: Record<string, number>
  notes?: string[]
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Benchmark {
  id: string
  title: string
  surface: Surface | null
  /** Samples per side in `trend` (exact benchmarks run once) */
  runs: number
  metrics: MetricSpec[]
  /** Returns one Sample per successful run; a run that throws is recorded as an error, not a sample */
  run: (
    ctx: BenchContext,
    runs: number
  ) => Promise<{ samples: Sample[]; errors: string[] }>
}

/** Every metric is exact: the benchmark belongs to `check`, not `trend` */
export const isExact = (b: Benchmark): boolean =>
  b.metrics.every((m) => m.exact === true)

export type MetricVerdict =
  | 'improved'
  | 'regressed'
  | 'unchanged'
  | 'inconclusive'

export interface MetricResult {
  key: string
  spec: MetricSpec
  verdict: MetricVerdict
  reference: number
  candidate: number
  /** candidate − reference, in the metric's unit */
  delta: number
  /** Holm-adjusted p-value of the rank-sum test */
  p: number
  threshold: number
  nReference: number
  nCandidate: number
  /**
   * Even the most extreme split of these sample counts (every candidate sample beyond every reference one) gives a
   * Holm-adjusted p ≥ ALPHA, so no difference could be significant; the verdict is then inconclusive
   */
  underpowered: boolean
}

export type Status = 'pass' | 'fail'

/** What `check` stamps for a tree; the PR hook and the release read it */
export interface Verdict {
  schema: 'harness/verdict@1'
  kind: 'check'
  repo: string
  tree: string
  sha: string
  branch: string
  at: string
  status: Status
  summary: string
  wallMs: number
  steps: { name: string; ms: number; status: Status; detail: string }[]
}
