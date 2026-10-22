// `trend`: the timing benchmarks, off the release path. A candidate commit (origin/main by default) is measured
// against a pinned reference commit, both served at once and alternated sample by sample (A B B A …), so a machine
// that slows down mid-run slows both sides alike. Each metric gets at least 12 samples a side; one whose samples
// can't reach significance is inconclusive, never a pass. The result is appended to the main checkout's
// .harness/queue.md for a person to read; nothing here blocks a release.

import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { cpus, loadavg } from 'node:os'
import path from 'node:path'

import { buildRef } from './build'
import { browserVersions, closeBrowsers, replayFonts } from './engines/browser'
import { compareMetrics } from './scorer/verdict'
import { serveBuild } from './server'
import type { BenchServer } from './server'
import { storeDir } from './store'
import type { Repo } from './store'
import { SUITE } from './suite'
import { isExact } from './types'
import type { Benchmark, MetricResult, Sample } from './types'

const MIN_RUNS = 12

const resolve = (repo: Repo, ref: string) =>
  execFileSync('git', ['-C', repo.top, 'rev-parse', `${ref}^{commit}`], {
    encoding: 'utf-8',
  }).trim()

const referenceFile = (repo: Repo) =>
  path.join(storeDir(repo, 'bench'), 'trend-reference')

/** The pinned reference: `--reference <ref>` pins it; later runs reuse it until it is pinned again */
const referenceSha = (repo: Repo, pin: string | undefined): string => {
  const file = referenceFile(repo)
  if (pin !== undefined) {
    const sha = resolve(repo, pin)
    writeFileSync(file, `${sha}\n`)
    return sha
  }
  if (!existsSync(file)) {
    throw new Error(
      'no reference pinned: run `bun harness/bench/cli.ts trend --reference <commit>` once (a release you trust, e.g. origin/main)'
    )
  }
  return readFileSync(file, 'utf-8').trim()
}

/**
 * Waits up to 5 minutes for the machine to be quiet (1-minute load under half the cores): builds, test suites and
 * other sessions' browsers running alongside showed up as a uniform 8–15% slowdown of every timing.
 */
const waitForQuiet = async (log: (m: string) => void): Promise<string> => {
  const limit = cpus().length / 2
  for (let waited = 0; waited < 300; waited += 15) {
    const [load] = loadavg()
    if (load < limit) {
      return ''
    }
    log(`machine busy (load ${load.toFixed(1)}, want < ${limit}); waiting`)
    // oxlint-disable-next-line eslint/no-await-in-loop -- polling the load until it drops
    await Bun.sleep(15_000)
  }
  return `the machine stayed busy (load ${loadavg()[0].toFixed(1)} on ${cpus().length} cores); both sides were slowed alike, but noise is higher`
}

const valuesOf = (ss: Sample[]) => {
  const o: Record<string, number[]> = {}
  for (const x of ss) {
    for (const [k, v] of Object.entries(x.values)) {
      if (Number.isFinite(v)) {
        ;(o[k] ??= []).push(v)
      }
    }
  }
  return o
}

const fmt = (v: number, unit: string) => {
  if (unit === 'cls' || unit === 'ratio') {
    return v.toFixed(3)
  }
  return unit === 'kb' ? v.toFixed(1) : Math.round(v).toString()
}

const pct = (m: MetricResult) =>
  m.reference === 0
    ? ''
    : ` (${((m.delta / Math.abs(m.reference)) * 100).toFixed(1)}%)`

interface Side {
  name: 'reference' | 'candidate'
  server: BenchServer
  dist: string
}

/** One benchmark, one sample at a time, alternating sides A B B A; each side gets one discarded warm-up first */
const alternate = async (
  repo: Repo,
  runId: string,
  bench: Benchmark,
  sides: [Side, Side],
  log: (m: string) => void
): Promise<{ samples: Record<Side['name'], Sample[]>; errors: string[] }> => {
  const samples: Record<Side['name'], Sample[]> = {
    candidate: [],
    reference: [],
  }
  const errors: string[] = []
  const runs = Math.max(MIN_RUNS, bench.runs)
  const once = async (side: Side, i: number, warmup: number) => {
    const r = await bench
      .run(
        {
          artifactDir: storeDir(
            repo,
            'bench',
            'runs',
            runId,
            bench.id,
            `${side.name}-${i}`
          ),
          distDir: side.dist,
          log: (m) => {
            log(`  ${bench.id} ${side.name}: ${m}`)
          },
          origin: side.server.origin,
          warmup,
        },
        1
      )
      .catch((error: unknown) => ({
        errors: [
          error instanceof Error ? error.message.split('\n')[0] : String(error),
        ],
        samples: [] as Sample[],
      }))
    samples[side.name].push(...r.samples)
    errors.push(...r.errors.map((e) => `${side.name} ${i}: ${e}`))
  }
  const [a, b] = sides
  for (let i = 0; i < runs; i += 1) {
    const order = i % 2 === 0 ? [a, b] : [b, a]
    for (const side of order) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- measurements must run one at a time
      await once(side, i, i === 0 ? 1 : 0)
    }
  }
  return { errors, samples }
}

export const runTrend = async (
  repo: Repo,
  opts: {
    only: string[] | null
    ref: string
    reference?: string
    log: (m: string) => void
  }
): Promise<'regressed' | 'inconclusive' | 'unchanged'> => {
  const { log } = opts
  const started = Date.now()
  const busy = await waitForQuiet(log)
  const refSha = referenceSha(repo, opts.reference)
  const candSha = resolve(repo, opts.ref)
  const runId = `trend-${new Date().toISOString().replaceAll(/[:.]/gu, '-').slice(0, 19)}`
  const benches = SUITE.filter((b) => !isExact(b)).filter(
    (b) => opts.only === null || opts.only.includes(b.id)
  )
  if (benches.length === 0) {
    throw new Error(
      `no timing benchmark matches --only ${opts.only?.join(',')}`
    )
  }
  const reference = await buildRef(repo, refSha, log)
  const candidate = await buildRef(repo, candSha, log)
  const serve = (dist: string) =>
    serveBuild({
      distDir: dist,
      fixturesDir: storeDir(repo, 'bench', 'fixtures'),
      mode: 'replay',
      repoTop: repo.top,
    })
  replayFonts(storeDir(repo, 'bench', 'fixtures', 'fonts'))
  const sides: [Side, Side] = [
    { dist: reference.dist, name: 'reference', server: serve(reference.dist) },
    { dist: candidate.dist, name: 'candidate', server: serve(candidate.dist) },
  ]
  const results: {
    bench: Benchmark
    metrics: MetricResult[]
    errors: string[]
  }[] = []
  try {
    for (const bench of benches) {
      log(
        `${bench.id}: ${Math.max(MIN_RUNS, bench.runs)} samples a side, alternated`
      )
      // oxlint-disable-next-line eslint/no-await-in-loop -- measurements must run one at a time
      const { samples, errors } = await alternate(
        repo,
        runId,
        bench,
        sides,
        log
      )
      results.push({
        bench,
        errors,
        metrics: compareMetrics(
          bench.metrics,
          valuesOf(samples.reference),
          valuesOf(samples.candidate)
        ),
      })
    }
  } finally {
    for (const s of sides) {
      s.server.stop()
    }
  }
  const { chrome } = await browserVersions()
  await closeBrowsers()

  const gated = results.flatMap((r) =>
    r.metrics.filter((m) => m.spec.gate).map((m) => ({ id: r.bench.id, m }))
  )
  const named = (v: MetricResult['verdict']) =>
    gated
      .filter((g) => g.m.verdict === v)
      .map((g) => `${g.id}.${g.m.key}${v === 'unchanged' ? '' : pct(g.m)}`)
  // A gated metric with no samples on a side can't be compared: it is inconclusive, never left out
  const unsampled = results.flatMap((r) =>
    r.bench.metrics
      .filter((spec) => spec.gate && !r.metrics.some((m) => m.key === spec.key))
      .map((spec) => `${r.bench.id}.${spec.key} (no samples on a side)`)
  )
  const regressed = named('regressed')
  const inconclusive = [...named('inconclusive'), ...unsampled]
  let outcome: 'regressed' | 'inconclusive' | 'unchanged' = 'unchanged'
  if (regressed.length > 0) {
    outcome = 'regressed'
  } else if (inconclusive.length > 0) {
    outcome = 'inconclusive'
  }

  const lines = [
    `# Trend ${runId}: ${outcome.toUpperCase()}`,
    '',
    `candidate ${opts.ref} @ ${candSha.slice(0, 8)} vs reference @ ${refSha.slice(0, 8)}, ${Math.round((Date.now() - started) / 60_000)} min, Chrome ${chrome}`,
    ...(busy === '' ? [] : [`- ${busy}`]),
    '',
  ]
  for (const r of results) {
    const lost = unsampled.filter((u) => u.startsWith(`${r.bench.id}.`))
    lines.push(
      `## ${r.bench.id}`,
      '',
      '| metric | reference | candidate | Δ | verdict |',
      '|---|---|---|---|---|'
    )
    for (const m of r.metrics) {
      lines.push(
        `| ${m.key}${m.spec.gate ? '' : ' ·'} | ${fmt(m.reference, m.spec.unit)} | ${fmt(m.candidate, m.spec.unit)} | ${fmt(m.delta, m.spec.unit)}${pct(m)} | ${m.verdict} p=${m.p.toFixed(3)} n=${m.nReference}/${m.nCandidate}${m.underpowered ? ' underpowered' : ''} |`
      )
    }
    for (const u of lost) {
      lines.push(`- inconclusive: ${u}`)
    }
    for (const e of r.errors.slice(0, 5)) {
      lines.push(`- error: ${e}`)
    }
    lines.push('')
  }
  lines.push(
    '`·` = reported, not gated. Mann–Whitney U, Holm-corrected per benchmark; a change must also exceed max(floor, pct × reference) (suite.ts). `underpowered`: even the most extreme split of these sample counts gives a Holm-adjusted p ≥ 0.05, so no difference could be significant; the verdict is inconclusive.'
  )
  const dir = storeDir(repo, 'bench', 'runs', runId)
  const reportFile = path.join(dir, 'report.md')
  writeFileSync(reportFile, `${lines.join('\n')}\n`)
  writeFileSync(
    path.join(dir, 'run.json'),
    JSON.stringify(
      {
        candidate: candSha,
        outcome,
        reference: refSha,
        results: results.map((r) => ({
          errors: r.errors,
          id: r.bench.id,
          metrics: r.metrics,
        })),
      },
      null,
      2
    )
  )
  const summary = [
    regressed.length > 0 ? `regressed: ${regressed.join(', ')}` : '',
    inconclusive.length > 0 ? `inconclusive: ${inconclusive.join(', ')}` : '',
    `${named('unchanged').length} unchanged`,
  ]
    .filter(Boolean)
    .join('; ')
  appendFileSync(
    path.join(storeDir(repo), 'queue.md'),
    `- ${new Date().toISOString().slice(0, 16)}Z trend ${outcome}: ${opts.ref} ${candSha.slice(0, 8)} vs reference ${refSha.slice(0, 8)} (${benches.map((b) => b.id).join(', ')}). ${summary}. Report: ${reportFile}\n`
  )
  process.stdout.write(
    `${lines.join('\n')}\n\nreport: ${reportFile}\nqueued in ${path.join(storeDir(repo), 'queue.md')}\n`
  )
  return outcome
}
