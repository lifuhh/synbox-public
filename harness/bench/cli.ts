// synbox bench: measure the app, judge it against a rolling baseline, stamp a verdict the PR gate reads.
//
//   bun harness/bench/cli.ts gate              the PR gate: smoke tier + held-out, baseline bootstrap, confirm, verdict
//   bun harness/bench/cli.ts run [--tier full] [--only id,id] [--api live]    measure and judge, no verdict
//   bun harness/bench/cli.ts baseline [--ref origin/main] [--tier full]       measure a ref into the baseline
//   bun harness/bench/cli.ts score             hill-climb objective (held-out hidden)
//   bun harness/bench/cli.ts climb propose <campaign> "<hypothesis>" | climb eval <campaign> | climb board <campaign>
//   bun harness/bench/cli.ts history | waive --reason "<why>" | list | serve [--port N]

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, loadavg, platform } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { buildRef, buildWorkingTree } from './build'
import {
  browserVersions,
  closeBrowsers,
  replayFonts,
  speedProbe,
} from './engines/browser'
import { evaluatorTouched } from './gate'
import { holdMachine } from './lock'
import { isRecord, parseJson } from './json'
import { cv } from './scorer/stats'
import { compareMetrics, score, statusOf } from './scorer/verdict'
import { serveBuild } from './server'
import type { ApiMode } from './server'
import {
  appendRun,
  baselineFor,
  candidateFor,
  loadHistory,
  mergeBase,
  readVerdict,
  repoAt,
  storeDir,
  writeVerdict,
} from './store'
import type { Key, Repo } from './store'
import { SUITE } from './suite'
import type {
  Benchmark,
  BenchResult,
  MachineInfo,
  MetricResult,
  Rect,
  RunRecord,
  Sample,
  Status,
  Tier,
} from './types'

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    api: { default: 'replay', type: 'string' },
    only: { type: 'string' },
    port: { type: 'string' },
    reason: { type: 'string' },
    ref: { default: 'origin/main', type: 'string' },
    tier: { default: 'smoke', type: 'string' },
  },
})
const [command = 'run', ...rest] = positionals
const log = (m: string): void => {
  process.stderr.write(`· ${m}\n`)
}
const firstLine = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0]
const cwd = process.cwd()

/** The tree of the commit this branch is judged against */
const baseTreeOf = (repo: Repo): string =>
  execFileSync(
    'git',
    ['-C', repo.top, 'rev-parse', `${mergeBase(repo.top)}^{tree}`],
    { encoding: 'utf-8' }
  ).trim()

const fileHash = (repo: Repo, files: string[]) =>
  createHash('sha256')
    .update(
      files.map((f) => readFileSync(path.join(repo.top, f), 'utf-8')).join('\0')
    )
    .digest('hex')

/**
 * What a benchmark measures: its metrics, surface, parameters and the source of every file that measures it.
 * Thresholds and gate flags are the scorer's and left out: changing how samples are judged keeps the samples.
 */
const specHash = (repo: Repo, b: Benchmark) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        metrics: b.metrics.map((m) => [m.key, m.unit, m.better]),
        params: b.params,
        surface: b.surface,
      }) + fileHash(repo, b.sources)
    )
    .digest('hex')
    .slice(0, 12)

const machineInfo = async (
  repo: Repo,
  before: number
): Promise<MachineInfo> => {
  const { chrome } = await browserVersions()
  const { version: playwright } = parseJson(
    readFileSync(
      path.join(repo.top, 'node_modules/playwright/package.json'),
      'utf-8'
    ),
    (v): v is { version: string } =>
      isRecord(v) && typeof v.version === 'string',
    'playwright/package.json'
  )
  const cpu = `${cpus()[0]?.model ?? 'cpu'} ×${cpus().length}`
  const fingerprint = createHash('sha256')
    .update([cpu, platform(), chrome.split('.')[0], playwright].join('|'))
    .digest('hex')
    .slice(0, 12)
  return {
    chrome,
    cpus: cpu,
    fingerprint,
    playwright,
    speed: { after: before, before },
  }
}

const epoch = (repo: Repo) => {
  const file = path.join(storeDir(repo, 'bench'), 'fixtures-epoch')
  return existsSync(file) ? readFileSync(file, 'utf-8').trim() : '0'
}

const conditionsOf = (repo: Repo, api: ApiMode) =>
  `api=${api};fixtures=${epoch(repo)}`

const pick = (tier: Tier, gate: boolean): Benchmark[] => {
  const only = flags.only?.split(',')
  return SUITE.filter((b) =>
    only
      ? only.includes(b.id)
      : b.tier === 'smoke' || tier === 'full' || (gate && b.heldOut === true)
  )
}

interface Measured {
  bench: Benchmark
  hash: string
  samples: Sample[]
  errors: string[]
}

/** Builds nothing; serves `dist` and runs each benchmark against it */
const measure = async (
  repo: Repo,
  dist: string,
  benches: Benchmark[],
  runId: string,
  api: ApiMode,
  opts: { runs?: number; warmup?: number; label?: string } = {}
): Promise<Measured[]> => {
  const server = serveBuild({
    distDir: dist,
    fixturesDir: storeDir(repo, 'bench', 'fixtures'),
    mode: api,
    repoTop: repo.top,
  })
  replayFonts(storeDir(repo, 'bench', 'fixtures', 'fonts'))
  const out: Measured[] = []
  const label = opts.label ?? ''
  try {
    for (const bench of benches) {
      const artifactDir = storeDir(
        repo,
        'bench',
        'runs',
        runId,
        `${bench.id}${label === '' ? '' : `-${label}`}`
      )
      log(`${bench.id}${label === '' ? '' : ` (${label})`}`)
      const started = Date.now()
      const exactOnly = bench.metrics.every((m) => m.exact === true)
      // oxlint-disable-next-line eslint/no-await-in-loop -- measurements must run one at a time
      const result = await bench
        .run(
          {
            artifactDir,
            distDir: dist,
            log: (m) => {
              log(`  ${bench.id}: ${m}`)
            },
            origin: server.origin,
            retry: label !== 'base',
            warmup: exactOnly ? 0 : (opts.warmup ?? 1),
          },
          opts.runs ?? bench.runs
        )
        .catch((error: unknown) => ({
          errors: [firstLine(error)],
          samples: [] as Sample[],
        }))
      log(
        `  ${bench.id}: ${result.samples.length} samples, ${result.errors.length} errors, ${Math.round((Date.now() - started) / 1000)}s`
      )
      out.push({
        bench,
        errors: result.errors,
        hash: specHash(repo, bench),
        samples: result.samples,
      })
    }
  } finally {
    server.stop()
    log(`api: ${JSON.stringify(server.counts)}`)
  }
  return out
}

const moved = (
  base: Record<string, Rect> | null,
  cand: Record<string, Rect> | undefined
): string[] => {
  if (!base || !cand) {
    return []
  }
  return Object.entries(cand).flatMap(([name, r]) => {
    const b: Rect | undefined = base[name]
    if (b === undefined) {
      return [`${name} appeared at ${r.x},${r.y} ${r.w}×${r.h}`]
    }
    const far = Math.max(
      Math.abs(b.x - r.x),
      Math.abs(b.y - r.y),
      Math.abs(b.w - r.w),
      Math.abs(b.h - r.h)
    )
    return far > 2
      ? [`${name} ${b.x},${b.y} ${b.w}×${b.h} → ${r.x},${r.y} ${r.w}×${r.h}`]
      : []
  })
}

const judge = (
  history: RunRecord[],
  measured: Measured[],
  key: Key,
  repo: Repo,
  role: RunRecord['role']
): BenchResult[] =>
  measured.map((m) => {
    const base = baselineFor(
      history,
      m.bench.id,
      m.hash,
      key,
      repo.tree,
      baseTreeOf(repo)
    )
    const cand = candidateFor(
      history,
      m.samples,
      m.bench.id,
      m.hash,
      key,
      repo.tree,
      role
    )
    return {
      errors: m.errors,
      id: m.bench.id,
      metrics: compareMetrics(m.bench.metrics, base.values, cand),
      moved: moved(base.landmarks, m.samples[0]?.landmarks),
      samples: m.samples,
      specHash: m.hash,
    }
  })

const benchStatus = (b: BenchResult): Status => {
  if (b.samples.length === 0) {
    return 'fail'
  }
  const s = statusOf(b.metrics)
  return s === 'pass' && (b.errors.length > 0 || b.moved.length > 0)
    ? 'warn'
    : s
}

const worst = (ss: Status[]): Status => {
  if (ss.includes('fail')) {
    return 'fail'
  }
  return ss.includes('warn') ? 'warn' : 'pass'
}

const fmt = (v: number | null, unit: string) => {
  if (v === null) {
    return '—'
  }
  if (unit === 'cls' || unit === 'ratio') {
    return v.toFixed(3)
  }
  return unit === 'kb' ? v.toFixed(1) : Math.round(v).toString()
}

const metricRow = (m: MetricResult): string => {
  const pct =
    m.baseline !== null && m.baseline !== 0 && !Number.isNaN(m.baseline)
      ? ` (${(((m.candidate - m.baseline) / Math.abs(m.baseline)) * 100).toFixed(1)}%)`
      : ''
  return `| ${m.key}${m.spec.gate ? '' : ' ·'} | ${fmt(m.baseline, m.spec.unit)} | ${fmt(m.candidate, m.spec.unit)} | ${m.delta === null ? '' : fmt(m.delta, m.spec.unit) + pct} | ${m.verdict}${m.p === null ? '' : ` p=${m.p.toFixed(3)}`} |`
}

const report = (run: RunRecord, hideHeldOut = false): string => {
  const lines = [
    `# Bench ${run.id} — ${run.status.toUpperCase()}`,
    '',
    `${run.git.branch} @ ${run.git.sha.slice(0, 8)} (tree ${run.git.tree.slice(0, 8)}), tier ${run.tier}, ${Math.round(run.wallMs / 1000)}s, Chrome ${run.machine.chrome}`,
    ...run.reasons.map((r) => `- ${r}`),
    '',
  ]
  for (const b of run.benches) {
    const spec = SUITE.find((s) => s.id === b.id)
    if (hideHeldOut && spec?.heldOut === true) {
      lines.push(`## ${b.id} (held out: ${benchStatus(b)})`, '')
      continue
    }
    lines.push(
      `## ${b.id} — ${benchStatus(b)} (${b.samples.length} samples)`,
      '',
      '| metric | baseline | candidate | Δ | verdict |',
      '|---|---|---|---|---|'
    )
    for (const m of b.metrics) {
      lines.push(metricRow(m))
    }
    const weak = b.metrics.filter((m) => m.underpowered).map((m) => m.key)
    if (weak.length > 0) {
      lines.push(
        `- underpowered (${b.metrics.find((m) => m.underpowered)?.nBase} vs ${b.metrics.find((m) => m.underpowered)?.nCand} samples): ${weak.join(', ')} can't be called regressed at this sample size; more runs (or more accepted runs in the baseline window) fix it`
      )
    }
    for (const e of b.errors) {
      lines.push(`- error: ${e}`)
    }
    for (const mv of b.moved) {
      lines.push(`- moved: ${mv}`)
    }
    for (const n of b.samples[0]?.notes ?? []) {
      lines.push(`- ${n}`)
    }
    lines.push('')
  }
  lines.push(
    '`·` = reported, not gated. Verdicts: Mann–Whitney U with Holm correction, change must also exceed max(floor, pct × baseline).'
  )
  return lines.join('\n')
}

const newRunId = () =>
  new Date().toISOString().replaceAll(/[:.]/gu, '-').slice(0, 19)

interface Session {
  repo: Repo
  key: Key
  machine: MachineInfo
  api: ApiMode
  tier: Tier
  started: number
}

/**
 * Waits up to 5 minutes for the machine to be quiet (1-minute load under half the cores): builds, test suites and
 * other sessions' browsers running alongside showed up as a uniform 8–15% slowdown of every timing.
 */
const waitForQuiet = async (): Promise<string | null> => {
  const limit = cpus().length / 2
  for (let waited = 0; waited < 300; waited += 15) {
    const [load] = loadavg()
    if (load < limit) {
      return null
    }
    log(`machine busy (load ${load.toFixed(1)}, want < ${limit}); waiting`)
    // oxlint-disable-next-line eslint/no-await-in-loop -- polling the load until it drops
    await Bun.sleep(15_000)
  }
  return `warn: the machine stayed busy (load ${loadavg()[0].toFixed(1)} on ${cpus().length} cores) while measuring; timings may read slow across the board`
}

const startSession = async (repo: Repo, tier: Tier): Promise<Session> => {
  const api = flags.api === 'live' ? 'live' : 'replay'
  const machine = await machineInfo(repo, speedProbe())
  return {
    api,
    key: {
      conditions: conditionsOf(repo, api),
      fingerprint: machine.fingerprint,
    },
    machine,
    repo,
    started: Date.now(),
    tier,
  }
}

const record = (
  s: Session,
  runId: string,
  git: RunRecord['git'],
  role: RunRecord['role'],
  benches: BenchResult[],
  status: Status,
  reasons: string[],
  accepted: boolean
): RunRecord => {
  const run: RunRecord = {
    accepted,
    at: new Date().toISOString(),
    benches,
    conditions: s.key.conditions,
    git,
    id: `${runId}${role === 'baseline' ? '-base' : ''}`,
    machine: {
      ...s.machine,
      speed: { after: speedProbe(), before: s.machine.speed.before },
    },
    reasons,
    role,
    schema: 'synbox-bench/run@1',
    status,
    tier: s.tier,
    wallMs: Date.now() - s.started,
  }
  appendRun(s.repo, run)
  return run
}

/** Measures `ref` (default: the merge base) as a baseline run and accepts it into the rolling window */
const measureBaseline = async (
  s: Session,
  benches: Benchmark[],
  runId: string,
  ref?: string
): Promise<Measured[]> => {
  const sha = ref ?? mergeBase(s.repo.top)
  const { dist, tree } = buildRef(s.repo, sha, log)
  // Twice the runs: a fresh baseline has no earlier runs to pool with, and 5 against 5 can't reach significance
  // once the gated metrics are corrected for
  // A trial run first: a probe that can't run on the base (a hook it waits for isn't there yet) fails once, not
  // ten times over its timeout, and leaves that benchmark without a baseline, so its metrics read as new
  const measured: Measured[] = []
  for (const bench of benches) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- measurements must run one at a time
    const [trial] = await measure(s.repo, dist, [bench], runId, s.api, {
      label: 'base',
      runs: 1,
    })
    const rest = bench.runs * 2 - 1
    if (trial.samples.length === 0 || rest <= 0) {
      if (trial.samples.length === 0) {
        log(`  ${bench.id}: no sample on the merge base; it gets no baseline`)
      }
      measured.push(trial)
      continue
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- measurements must run one at a time
    const [more] = await measure(s.repo, dist, [bench], runId, s.api, {
      label: 'base',
      runs: rest,
      warmup: 0,
    })
    measured.push({
      ...trial,
      errors: [...trial.errors, ...more.errors],
      samples: [...trial.samples, ...more.samples],
    })
  }
  const baseRepo = { ...s.repo, tree }
  const results = judge(
    loadHistory(s.repo),
    measured,
    s.key,
    baseRepo,
    'baseline'
  )
  record(
    s,
    runId,
    { branch: 'baseline', ref: sha, sha, tree },
    'baseline',
    results,
    worst(results.map(benchStatus)),
    [],
    true
  )
  return measured
}

const valuesOf = (ss: Sample[]) => {
  const o: Record<string, number[]> = {}
  for (const x of ss) {
    for (const [k, v] of Object.entries(x.values)) {
      ;(o[k] ??= []).push(v)
    }
  }
  return o
}

/**
 * Confirms suspected regressions against the merge base, measured now and interleaved in blocks (B A A B), so
 * machine drift since the baseline was taken can't masquerade as a regression or hide one.
 */
const confirm = async (
  s: Session,
  suspects: Benchmark[],
  dist: string,
  runId: string
): Promise<Map<string, BenchResult>> => {
  const sha = mergeBase(s.repo.top)
  const base = buildRef(s.repo, sha, log)
  const blocks: { side: 'A' | 'B'; dist: string }[] = [
    { dist, side: 'B' },
    { dist: base.dist, side: 'A' },
    { dist: base.dist, side: 'A' },
    { dist, side: 'B' },
  ]
  const pooled = new Map<
    string,
    { A: Sample[]; B: Sample[]; errors: string[] }
  >()
  for (const [i, block] of blocks.entries()) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- measurements must run one at a time
    const m = await measure(s.repo, block.dist, suspects, runId, s.api, {
      label: `confirm-${i}${block.side}`,
      runs: 4,
      // Every block warms up: each one starts a new server and browser context, and its first load is not typical
      warmup: 1,
    })
    for (const r of m) {
      const p = pooled.get(r.bench.id) ?? { A: [], B: [], errors: [] }
      p[block.side].push(...r.samples)
      p.errors.push(...r.errors)
      pooled.set(r.bench.id, p)
    }
  }
  const out = new Map<string, BenchResult>()
  for (const bench of suspects) {
    const p = pooled.get(bench.id)
    if (!p) {
      continue
    }
    out.set(bench.id, {
      confirm: { base: p.A, cand: p.B },
      errors: p.errors,
      id: bench.id,
      metrics: compareMetrics(bench.metrics, valuesOf(p.A), valuesOf(p.B)),
      moved: [],
      samples: p.B,
      specHash: specHash(s.repo, bench),
    })
  }
  return out
}

const reasonStatus = (r: string): Status => {
  if (r.startsWith('fail')) {
    return 'fail'
  }
  return r.startsWith('warn') ? 'warn' : 'pass'
}

/** No baseline under these conditions (first run, new machine, a benchmark's spec changed): measure the merge base */
const bootstrapMissing = async (
  s: Session,
  repo: Repo,
  measured: Measured[],
  runId: string,
  gate: boolean
): Promise<string | null> => {
  const history = loadHistory(repo)
  const missing = measured.filter(
    (m) =>
      baselineFor(
        history,
        m.bench.id,
        m.hash,
        s.key,
        repo.tree,
        baseTreeOf(repo)
      ).runs.length === 0
  )
  if (missing.length === 0 || (!gate && flags.only !== undefined)) {
    return null
  }
  log(
    `no baseline for ${missing.map((m) => m.bench.id).join(', ')}: measuring the merge base`
  )
  await measureBaseline(
    s,
    missing.map((m) => m.bench),
    runId
  )
  return `baseline bootstrapped from the merge base for ${missing.length} benchmark(s)`
}

const worse = (m: MetricResult) =>
  (m.delta ?? 0) * (m.spec.better === 'lower' ? 1 : -1) > 0

/** Which gated metrics send their benchmark to the confirm stage */
const isSuspect = (
  mode: 'gate' | 'climb' | 'run',
  m: MetricResult
): boolean => {
  if (!m.spec.gate || m.spec.exact === true || mode === 'run') {
    return false
  }
  if (mode === 'climb') {
    return (
      m.verdict === 'regressed' ||
      m.verdict === 'improved' ||
      m.verdict === 'inconclusive'
    )
  }
  return m.verdict === 'regressed' || (m.verdict === 'inconclusive' && worse(m))
}

/**
 * `gate` confirms suspected regressions and stamps a verdict. `climb` confirms every gated metric that moved, either
 * way, because a step is kept on an improvement and an unconfirmed one is often noise or main moving underneath.
 * `run` only measures and judges.
 */
const runBench = async (mode: 'gate' | 'run' | 'climb') => {
  const gate = mode === 'gate'
  const repo = repoAt(cwd)
  const tier: Tier = flags.tier === 'full' ? 'full' : 'smoke'
  const reasons: string[] = []
  if (gate && repo.dirty) {
    throw new Error(
      'the gate judges committed code: commit (or stash) your changes first, the verdict is keyed by the tree'
    )
  }
  const busy = await waitForQuiet()
  if (busy !== null) {
    reasons.push(busy)
  }
  const s = await startSession(repo, tier)
  const runId = newRunId()
  const benches = pick(tier, gate)
  const dist = buildWorkingTree(repo, log)
  const measured = await measure(repo, dist, benches, runId, s.api)

  const bootstrapped = await bootstrapMissing(s, repo, measured, runId, gate)
  if (bootstrapped !== null) {
    reasons.push(bootstrapped)
  }

  let results = judge(loadHistory(repo), measured, s.key, repo, 'candidate')

  if (mode !== 'run') {
    const suspects = results
      .filter((b) => b.metrics.some((m) => isSuspect(mode, m)))
      .map((b) => SUITE.find((x) => x.id === b.id))
      .filter((b): b is Benchmark => Boolean(b))
    if (suspects.length > 0) {
      log(
        `confirming ${suspects.map((b) => b.id).join(', ')} against the merge base, interleaved`
      )
      const confirmed = await confirm(s, suspects, dist, runId)
      results = results.map((r) => {
        const c = confirmed.get(r.id)
        return c ? { ...c, moved: r.moved, samples: r.samples } : r
      })
      reasons.push(
        `confirmed ${suspects.length} suspect benchmark(s) interleaved against the merge base`
      )
    }
  }

  if (gate) {
    const base = mergeBase(repo.top)
    const touched = evaluatorTouched(repo.changed, (f) => {
      try {
        execFileSync(
          'git',
          ['-C', repo.top, 'cat-file', '-e', `${base}:${f}`],
          { stdio: 'ignore' }
        )
        return true
      } catch {
        return false
      }
    })
    if (touched !== null) {
      reasons.push(`fail: ${touched}`)
    }
  }

  const speedNow = speedProbe()
  const baseRuns = loadHistory(repo)
    .filter((r) => r.accepted && r.machine.fingerprint === s.key.fingerprint)
    .slice(-3)
  if (baseRuns.length > 0) {
    const baseSpeed =
      baseRuns.reduce((a, r) => a + r.machine.speed.before, 0) / baseRuns.length
    const drift = Math.abs(speedNow - baseSpeed) / baseSpeed
    if (drift > 0.15) {
      reasons.push(
        `warn: machine speed differs from the baseline runs by ${Math.round(drift * 100)}% (busy machine?); timings are less comparable`
      )
    }
  }
  for (const b of results) {
    if (b.samples.length === 0) {
      reasons.push(
        `fail: ${b.id} produced no samples (${b.errors[0] ?? 'unknown error'}): the page or a selector changed; fix the probe`
      )
    }
  }
  const status = worst([
    ...results.map(benchStatus),
    ...reasons.map(reasonStatus),
  ])
  const accepted = !repo.dirty && status !== 'fail'
  const run = record(
    s,
    runId,
    { branch: repo.branch, ref: 'HEAD', sha: repo.sha, tree: repo.tree },
    'candidate',
    results,
    status,
    reasons,
    accepted
  )
  const text = report(run)
  const dir = storeDir(repo, 'bench', 'runs', run.id)
  writeFileSync(path.join(dir, 'report.md'), text)
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run, null, 2))
  process.stdout.write(`${text}\n\nreport: ${path.join(dir, 'report.md')}\n`)
  if (gate) {
    const regressions = run.benches.flatMap((b) =>
      b.metrics
        .filter((m) => m.spec.gate && m.verdict === 'regressed')
        .map((m) => `${b.id}.${m.key}`)
    )
    const file = writeVerdict(repo, {
      at: run.at,
      branch: repo.branch,
      repo: 'synbox',
      run: run.id,
      schema: 'harness/verdict@1',
      sha: repo.sha,
      status,
      summary:
        status === 'pass'
          ? 'no regressions'
          : [
              ...regressions.map((r) => `regressed ${r}`),
              ...reasons.filter(
                (r) => !r.startsWith('baseline') && !r.startsWith('confirmed')
              ),
            ].join('; ') || 'drift without proof (see report)',
      tree: repo.tree,
    })
    process.stdout.write(`verdict: ${status} → ${file}\n`)
  }
  await closeBrowsers()
  process.exitCode = status === 'fail' ? 3 : 0
}

const climbDir = (repo: Repo, campaign: string) =>
  storeDir(repo, 'hillclimb', campaign)

interface ClimbEntry {
  type: 'proposal' | 'result'
  n: number
  at: string
  sha: string
  tree: string
  hypothesis?: string
  hash?: string
  score?: number | null
  status?: Status
  accepted?: boolean
  run?: string
}

const isClimbEntry = (v: unknown): v is ClimbEntry =>
  isRecord(v) && (v.type === 'proposal' || v.type === 'result')

const climbLog = (repo: Repo, campaign: string): ClimbEntry[] => {
  const file = path.join(climbDir(repo, campaign), 'log.jsonl')
  return existsSync(file)
    ? readFileSync(file, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((l) => parseJson(l, isClimbEntry, `a line of ${file}`))
    : []
}

const climbAppend = (repo: Repo, campaign: string, e: ClimbEntry): void => {
  writeFileSync(
    path.join(climbDir(repo, campaign), 'log.jsonl'),
    `${JSON.stringify(e)}\n`,
    { flag: 'a' }
  )
}

const isHeldOut = (id: string): boolean =>
  SUITE.find((s) => s.id === id)?.heldOut === true

const climbPropose = (
  repo: Repo,
  campaign: string,
  entries: ClimbEntry[],
  words: string[]
): void => {
  const hypothesis = words.join(' ').trim()
  if (hypothesis === '') {
    throw new Error(
      'a proposal needs its hypothesis: what you will change, and which metric should move and why'
    )
  }
  const n = entries.filter((e) => e.type === 'proposal').length + 1
  // Frozen before any result exists: the hash proves the write-up wasn't rationalised afterwards
  const hash = createHash('sha256')
    .update(hypothesis)
    .digest('hex')
    .slice(0, 12)
  climbAppend(repo, campaign, {
    at: new Date().toISOString(),
    hash,
    hypothesis,
    n,
    sha: repo.sha,
    tree: repo.tree,
    type: 'proposal',
  })
  process.stdout.write(`proposal ${n} frozen (${hash})\n`)
}

const climbEval = async (
  repo: Repo,
  campaign: string,
  entries: ClimbEntry[]
): Promise<void> => {
  const proposal = entries.findLast((e) => e.type === 'proposal')
  if (
    !proposal ||
    entries.some((e) => e.type === 'result' && e.n === proposal.n)
  ) {
    throw new Error(
      'propose first: every evaluation answers exactly one frozen proposal'
    )
  }
  if (repo.dirty) {
    throw new Error(
      'commit the candidate first (each climb step is a commit, so accepted steps stay bisectable)'
    )
  }
  if (entries.some((e) => e.type === 'result' && e.tree === repo.tree)) {
    throw new Error(
      'this tree was already evaluated: an unchanged re-run is a re-roll of the noise, not a new method'
    )
  }
  await runBench('climb')
  const run = loadHistory(repo).findLast(
    (r) => r.role === 'candidate' && r.git.tree === repo.tree
  )
  const climbable = run?.benches.filter((b) => !isHeldOut(b.id)) ?? []
  const value = score(climbable.flatMap((b) => b.metrics))
  const best = Math.max(
    1,
    ...entries.flatMap((e) =>
      e.accepted === true && typeof e.score === 'number' ? [e.score] : []
    )
  )
  const accepted =
    run !== undefined && run.status !== 'fail' && value !== null && value > best
  climbAppend(repo, campaign, {
    accepted,
    at: new Date().toISOString(),
    n: proposal.n,
    run: run?.id,
    score: value,
    sha: repo.sha,
    status: run?.status,
    tree: repo.tree,
    type: 'result',
  })
  process.stdout.write(
    `score ${value?.toFixed(4) ?? '—'} (best so far ${best.toFixed(4)}): ${accepted ? 'ACCEPT — keep this commit' : 'REJECT — revert this commit'}\n`
  )
}

const climbBoard = (entries: ClimbEntry[]): void => {
  const results = entries.filter((e) => e.type === 'result')
  for (const r of results.toSorted((a, b) => (b.score ?? 0) - (a.score ?? 0))) {
    const p = entries.find((e) => e.type === 'proposal' && e.n === r.n)
    process.stdout.write(
      `${r.accepted === true ? '✓' : '✗'} #${r.n} score ${r.score?.toFixed(4) ?? '—'} ${r.status} ${r.sha.slice(0, 8)}  ${p?.hypothesis ?? ''}\n`
    )
  }
}

const climb = async () => {
  const [sub, campaign, ...words] = rest
  if (!sub || !campaign) {
    throw new Error(
      'usage: climb propose <campaign> "<hypothesis>" | climb eval <campaign> | climb board <campaign>'
    )
  }
  const repo = repoAt(cwd)
  const entries = climbLog(repo, campaign)
  switch (sub) {
    case 'propose': {
      climbPropose(repo, campaign, entries, words)
      break
    }
    case 'eval': {
      await climbEval(repo, campaign, entries)
      break
    }
    case 'board': {
      climbBoard(entries)
      break
    }
    default: {
      throw new Error(`unknown climb command ${sub}`)
    }
  }
}

const printHistory = (repo: Repo): void => {
  for (const r of loadHistory(repo).slice(-30)) {
    const gated = r.benches.flatMap((b) =>
      b.metrics
        .filter((m) => m.spec.gate && m.spec.exact !== true)
        .map((m) => m.key)
    )
    const cvs = r.benches.flatMap((b) =>
      b.metrics
        .filter((m) => m.spec.gate && m.spec.exact !== true)
        .map((m) =>
          cv(b.samples.map((x) => x.values[m.key]).filter(Number.isFinite))
        )
    )
    const meanCv = cvs.length ? cvs.reduce((a, c) => a + c, 0) / cvs.length : 0
    const errors = r.benches.reduce((a, b) => a + b.errors.length, 0)
    process.stdout.write(
      `${r.id} ${r.role.padEnd(9)} ${r.status.padEnd(4)} ${r.accepted ? 'acc' : '   '} ${r.git.branch.slice(0, 28).padEnd(28)} ${r.git.sha.slice(0, 8)} ${String(Math.round(r.wallMs / 1000)).padStart(5)}s cv ${(meanCv * 100).toFixed(1)}% (${gated.length} gated) errors ${errors}\n`
    )
  }
}

const waive = (repo: Repo): void => {
  const v = readVerdict(repo)
  const reason = flags.reason ?? ''
  if (reason === '') {
    throw new Error(
      'a waiver needs --reason "<why this regression is accepted>"; it is kept in the verdict'
    )
  }
  if (!v) {
    throw new Error('nothing to waive: run the gate on this tree first')
  }
  writeVerdict(repo, {
    ...v,
    at: new Date().toISOString(),
    status: 'waived',
    waiver: reason,
  })
  process.stdout.write(
    `waived ${v.status} verdict for tree ${repo.tree.slice(0, 8)}\n`
  )
}

const main = async () => {
  switch (command) {
    case 'gate': {
      await runBench('gate')
      break
    }
    case 'run': {
      await runBench('run')
      break
    }
    case 'baseline': {
      const repo = repoAt(cwd)
      const s = await startSession(
        repo,
        flags.tier === 'full' ? 'full' : 'smoke'
      )
      await measureBaseline(s, pick(s.tier, true), newRunId(), flags.ref)
      await closeBrowsers()
      break
    }
    case 'score': {
      const repo = repoAt(cwd)
      const run = loadHistory(repo).findLast(
        (r) => r.role === 'candidate' && r.git.tree === repo.tree
      )
      if (!run) {
        throw new Error(
          'no run of this tree yet: `bun harness/bench/cli.ts run` first'
        )
      }
      const climbable = run.benches.filter((b) => !isHeldOut(b.id))
      process.stdout.write(
        `${report({ ...run, benches: climbable }, true)}\n\nscore ${score(climbable.flatMap((b) => b.metrics))?.toFixed(4) ?? '—'} (1 = baseline; higher is better)\n`
      )
      break
    }
    case 'climb': {
      await climb()
      break
    }
    case 'history': {
      printHistory(repoAt(cwd))
      break
    }
    case 'waive': {
      waive(repoAt(cwd))
      break
    }
    case 'serve': {
      // The bench's server for this working tree, for driving by hand or with cdp-perf directly; Ctrl-C stops it
      const repo = repoAt(cwd)
      const dist = buildWorkingTree(repo, log)
      const server = serveBuild({
        distDir: dist,
        fixturesDir: storeDir(repo, 'bench', 'fixtures'),
        mode: flags.api === 'live' ? 'live' : 'replay',
        port: Number(flags.port ?? 0),
        repoTop: repo.top,
      })
      process.stdout.write(`${server.origin}\n`)
      // oxlint-disable-next-line promise/avoid-new -- a promise that never settles keeps the command running until Ctrl-C
      await new Promise(() => {
        // never settles
      })
      break
    }
    case 'list': {
      for (const b of SUITE) {
        process.stdout.write(
          `${b.id.padEnd(34)} ${b.tier.padEnd(5)} ${b.heldOut === true ? 'held-out ' : '         '}${b.title}\n`
        )
      }
      break
    }
    default: {
      throw new Error(`unknown command ${command}`)
    }
  }
}

// What measures, and so needs the machine to itself
const measuring =
  command === 'gate' ||
  command === 'run' ||
  command === 'baseline' ||
  (command === 'climb' && positionals[1] === 'eval')

try {
  const release = measuring
    ? await holdMachine(repoAt(cwd), command, log)
    : () => {
        // nothing held
      }
  try {
    await main()
  } finally {
    release()
  }
} catch (error) {
  process.stderr.write(
    `bench: ${error instanceof Error ? error.message : String(error)}\n`
  )
  await closeBrowsers()
  process.exitCode = 1
}
