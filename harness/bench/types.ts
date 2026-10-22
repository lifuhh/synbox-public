// The bench's domain. A benchmark yields samples (one value per metric per run); a scorer turns samples plus a
// baseline into verdicts; a run record is what the store keeps.

export type Unit = 'ms' | 'fps' | 'ratio' | 'count' | 'kb' | 'cls'
export type Better = 'lower' | 'higher'

export interface MetricSpec {
  key: string
  unit: Unit
  better: Better
  /** Smallest absolute change worth reporting */
  floor: number
  /** Smallest relative change worth reporting, as a fraction of the baseline median */
  pct: number
  /** Gated metrics decide the verdict; the rest are reported */
  gate: boolean
  /** One sample per run is exact (sizes, layout counts): compared directly, no statistics */
  exact?: boolean
}

export type Tier = 'smoke' | 'full'

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
  /** Discarded runs before measuring (1 normally; 0 when interleaving blocks that are already warm) */
  warmup: number
  log: (message: string) => void
}

/** One run's numbers, plus layout findings that explain them */
export interface Sample {
  values: Record<string, number>
  notes?: string[]
  /** Layout landmark rectangles, compared run to run as positions */
  landmarks?: Record<string, Rect>
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
  tier: Tier
  /** Kept out of the hill-climb score; checked only at the gate (generalisation check) */
  heldOut?: boolean
  surface: Surface | null
  /** Measured runs (probes discard one warm-up first, unless every metric is exact) */
  runs: number
  metrics: MetricSpec[]
  /** Source files whose content defines what this benchmark measures; part of its spec hash */
  sources: string[]
  /** What else defines the measurement (page, song, lab flags); part of its spec hash */
  params?: Record<string, unknown>
  /** Returns one Sample per successful run; a run that throws is recorded as an error, not a sample */
  run: (
    ctx: BenchContext,
    runs: number
  ) => Promise<{ samples: Sample[]; errors: string[] }>
}

export type MetricVerdict =
  | 'improved'
  | 'regressed'
  | 'unchanged'
  | 'inconclusive'
  | 'new'

export interface MetricResult {
  key: string
  spec: MetricSpec
  verdict: MetricVerdict
  baseline: number | null
  candidate: number
  /** candidate − baseline, in the metric's unit */
  delta: number | null
  /** Holm-adjusted p-value of the rank-sum test; null for exact metrics */
  p: number | null
  threshold: number | null
  nBase: number
  nCand: number
  /** Too few samples for any difference to reach significance after correction: add runs before trusting "unchanged" */
  underpowered: boolean
}

export type Status = 'pass' | 'warn' | 'fail'

export interface BenchResult {
  id: string
  specHash: string
  samples: Sample[]
  errors: string[]
  metrics: MetricResult[]
  /** Landmarks that moved more than 2px against the baseline's */
  moved: string[]
  /** The interleaved re-measurement whose samples decided `metrics`, when the gate confirmed a suspect */
  confirm?: { base: Sample[]; cand: Sample[] }
}

export interface MachineInfo {
  /** Hash of CPU model, core count, platform, Chrome major and Playwright version */
  fingerprint: string
  chrome: string
  playwright: string
  cpus: string
  /** ms for a fixed JS workload, before and after the runs (drift check) */
  speed: { before: number; after: number }
}

export interface RunRecord {
  schema: 'synbox-bench/run@1'
  id: string
  at: string
  tier: Tier
  git: { sha: string; tree: string; branch: string; ref: string }
  /** Set when this run measured another ref as the baseline (merge-base bootstrap or confirm) */
  role: 'candidate' | 'baseline'
  machine: MachineInfo
  conditions: string
  benches: BenchResult[]
  status: Status
  reasons: string[]
  accepted: boolean
  wallMs: number
}

export interface Verdict {
  schema: 'harness/verdict@1'
  repo: string
  tree: string
  sha: string
  branch: string
  at: string
  status: Status | 'waived'
  summary: string
  run: string | null
  waiver?: string
}
