// `check`: the exact checks a change must pass before it goes into staging, and staging before it ships. Nothing
// here is timed, so nothing needs a baseline or a quiet machine: typecheck, lint, tests and format, bytes shipped
// against harness/budgets.json, and a layout audit of every route on every screen against the same budgets. It
// stops at the first failure, prints each step's seconds, and stamps a verdict for the committed tree.

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { buildWorkingTree } from './build'
import { closeBrowsers, replayFonts } from './engines/browser'
import { evaluatorTouched } from './gate'
import { isRecord, parseJson } from './json'
import { serveBuild } from './server'
import { changedSince, existedAt, storeDir, writeVerdict } from './store'
import type { Repo } from './store'
import { SUITE } from './suite'
import { isExact } from './types'
import type { Benchmark, Sample, Status, Verdict } from './types'

/** Where a branch's own changes start: what it adds to staging */
const STAGING = 'origin/staging'
const STATIC = ['typecheck', 'lint', 'test', 'fmt:check']

type Budgets = Record<string, Record<string, number>>

const isBudgets = (v: unknown): v is Budgets =>
  isRecord(v) &&
  Object.entries(v).every(
    ([k, b]) =>
      k.startsWith('$') ||
      (isRecord(b) && Object.values(b).every((n) => typeof n === 'number'))
  )

const readBudgets = (repo: Repo): Budgets =>
  parseJson(
    readFileSync(path.join(repo.top, 'harness', 'budgets.json'), 'utf-8'),
    isBudgets,
    'harness/budgets.json'
  )

/** Every gated metric over its budget; a metric with no budget has a budget of 0 */
export const overBudget = (
  bench: Benchmark,
  sample: Sample,
  budgets: Budgets
): string[] =>
  bench.metrics
    .filter((m) => m.gate)
    .flatMap((m) => {
      const value = sample.values[m.key]
      const budget = budgets[bench.id]?.[m.key] ?? 0
      if (value === undefined) {
        return [`${m.key} missing`]
      }
      const shown = m.unit === 'kb' ? value.toFixed(1) : String(value)
      return value > budget ? [`${m.key} ${shown} > budget ${budget}`] : []
    })

interface Step {
  name: string
  ms: number
  status: Status
  detail: string
}

const sh = async (
  cwd: string,
  cmd: string,
  args: string[]
): Promise<{ ok: boolean; out: string }> =>
  // oxlint-disable-next-line promise/avoid-new -- wraps a child process's exit
  await new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      out += d.toString()
    })
    child.on('close', (code) => {
      resolve({ ok: code === 0, out })
    })
  })

const tail = (text: string, lines = 15) =>
  text.trim().split('\n').slice(-lines).join('\n')

export interface CheckResult {
  status: Status
  steps: Step[]
  wallMs: number
  verdict: string | null
}

export const runCheck = async (
  repo: Repo,
  opts: { only: string[] | null; jobs: number; log: (m: string) => void }
): Promise<CheckResult> => {
  const started = Date.now()
  const steps: Step[] = []
  const say = (s: Step) => {
    steps.push(s)
    process.stdout.write(
      `${s.status === 'pass' ? 'ok  ' : 'FAIL'} ${s.name.padEnd(36)} ${(s.ms / 1000).toFixed(1).padStart(5)}s${s.detail === '' ? '' : `  ${s.detail.split('\n').join('\n      ')}`}\n`
    )
  }
  const failed = () => steps.some((s) => s.status === 'fail')
  const full = opts.only === null

  const phases = async (): Promise<void> => {
    if (full) {
      const t = Date.now()
      const touched = evaluatorTouched(changedSince(repo, STAGING), (f) =>
        existedAt(repo, STAGING, f)
      )
      say({
        detail: touched ?? '',
        ms: Date.now() - t,
        name: 'evaluator untouched by app changes',
        status: touched === null ? 'pass' : 'fail',
      })
      if (failed()) {
        return
      }
    }

    // The build and the static checks share the CPU; none of them is timed
    const build = (async (): Promise<string | null> => {
      const t = Date.now()
      try {
        const out = await buildWorkingTree(repo, opts.log)
        say({ detail: '', ms: Date.now() - t, name: 'build', status: 'pass' })
        return out
      } catch (error) {
        say({
          detail: tail(error instanceof Error ? error.message : String(error)),
          ms: Date.now() - t,
          name: 'build',
          status: 'fail',
        })
        return null
      }
    })()
    const statics = full
      ? STATIC.map(async (script) => {
          const t = Date.now()
          const r = await sh(repo.top, 'bun', ['run', script])
          say({
            detail: r.ok ? '' : tail(r.out),
            ms: Date.now() - t,
            name: script,
            status: r.ok ? 'pass' : 'fail',
          })
        })
      : []
    const [dist] = await Promise.all([build, ...statics])
    if (failed() || dist === null) {
      return
    }

    const budgets = readBudgets(repo)
    const benches = SUITE.filter(isExact).filter(
      (b) => opts.only === null || opts.only.some((o) => b.id.startsWith(o))
    )
    if (benches.length === 0) {
      throw new Error(`no check matches --only ${opts.only?.join(',')}`)
    }
    const server = serveBuild({
      distDir: dist,
      fixturesDir: storeDir(repo, 'bench', 'fixtures'),
      mode: 'replay',
      repoTop: repo.top,
    })
    replayFonts(storeDir(repo, 'bench', 'fixtures', 'fonts'))
    const runId = `check-${new Date().toISOString().replaceAll(/[:.]/gu, '-').slice(0, 19)}`
    const measureOne = async (bench: Benchmark): Promise<void> => {
      const artifactDir = storeDir(repo, 'bench', 'runs', runId, bench.id)
      const t = Date.now()
      const once = async () => {
        const r = await bench
          .run(
            {
              artifactDir,
              distDir: dist,
              log: (m) => {
                opts.log(`${bench.id}: ${m}`)
              },
              origin: server.origin,
              warmup: 0,
            },
            1
          )
          .catch((error: unknown) => ({
            errors: [error instanceof Error ? error.message : String(error)],
            samples: [] as Sample[],
          }))
        const [sample] = r.samples
        const problems =
          sample === undefined
            ? [`no sample: ${r.errors[0] ?? 'unknown error'}`]
            : overBudget(bench, sample, budgets)
        return { problems, sample }
      }
      // One retry: a single run, and a live YouTube player that never finishes loading (seen once in four runs
      // of the desktop player) would otherwise fail the check on its own
      let result = await once()
      let retried = ''
      if (result.problems.length > 0) {
        retried = `retried after: ${result.problems.join('; ')}`
        result = await once()
      }
      const ok = result.problems.length === 0
      say({
        detail: ok
          ? retried
          : [
              ...result.problems,
              ...(result.sample?.notes ?? []),
              `screenshot: ${path.join(artifactDir, 'screen.png')}`,
            ].join('\n'),
        ms: Date.now() - t,
        name: bench.id,
        status: ok ? 'pass' : 'fail',
      })
    }
    // `jobs` audits at a time, each in its own browser context; none starts after a failure
    const queue = benches.filter((b) => b.surface !== null)
    const worker = async (): Promise<void> => {
      for (let b = queue.shift(); b && !failed(); b = queue.shift()) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- each worker takes the next audit when it is free
        await measureOne(b)
      }
    }
    try {
      // Bytes first, alone: the cheapest check, and the commonest failure
      const size = benches.filter((b) => b.surface === null)
      for (const b of size) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one at a time, before any browser starts
        await measureOne(b)
      }
      await Promise.all(Array.from({ length: opts.jobs }, worker))
      process.stdout.write(
        `screenshots: ${storeDir(repo, 'bench', 'runs', runId)}\n`
      )
    } finally {
      server.stop()
      await closeBrowsers()
    }
  }
  await phases()

  const status: Status = failed() ? 'fail' : 'pass'
  const wallMs = Date.now() - started
  let verdict: string | null = null
  if (full && !repo.dirty) {
    const v: Verdict = {
      at: new Date().toISOString(),
      branch: repo.branch,
      kind: 'check',
      repo: 'synbox',
      schema: 'harness/verdict@1',
      sha: repo.sha,
      status,
      steps,
      summary:
        status === 'pass'
          ? 'all checks pass'
          : steps
              .filter((s) => s.status === 'fail')
              .map((s) => `${s.name}: ${s.detail.split('\n')[0]}`)
              .join('; '),
      tree: repo.tree,
      wallMs,
    }
    verdict = writeVerdict(repo, v)
  }
  return { status, steps, verdict, wallMs }
}
