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
      /** The narrowest phone the app supports, 320×568 (an iPhone SE in Safari, no insets): WCAG's 320px reflow */
      narrow?: true
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
  /**
   * It samples over time (frame by frame, or every few ms while a song plays), so it runs last with the machine to
   * itself: no other session's browser audits beside it (lock.ts)
   */
  timing?: true
  /**
   * What a PR's scoped `check` runs it for (scope.ts): the routes of src/app.tsx it visits and its probe module
   * (a change to either runs it), or 'always'. Without one it always runs
   */
  scope?: BenchScope | 'always'
}

export interface BenchScope {
  routes: string[]
  /** Repo-relative path of the module that runs it; everything it imports counts as the probe */
  probe: string
  /**
   * The app-shell modules whose rendering it measures (with everything they import): a change elsewhere in the shell
   * doesn't run it. Absent: the whole shell, so any shell change runs it
   */
  shell?: string[]
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
  /**
   * Which audits ran and why. `full`: all of them (`--full`, the release, a clean checkout of staging). `scoped`:
   * those the branch's diff against `base` reaches. Absent on verdicts from before scoping, which ran everything
   */
  scope?: {
    mode: 'full' | 'scoped'
    base: string | null
    why: string[]
    ran: Record<string, string>
    skipped: number
  }
  /** Stamped without a run: only docs changed since the passing verdict of `tree` (commit `sha`) */
  reused?: { tree: string; sha: string; files: string[] }
}
