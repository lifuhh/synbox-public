// `check`: the exact checks a change must pass before it goes into staging, and staging before it ships. Nothing
// here is compared with a baseline: typecheck, lint, tests and format, bytes shipped against harness/budgets.json,
// and browser audits of the app's routes (harness/routes.json says which are skipped) on desktop and phone screens
// against the same budgets. A PR's check runs the browser audits its diff can affect (scope.ts); `--full`, which
// the release uses, runs them all. It stops at the first failure, prints each step's seconds, and stamps a verdict
// for the committed tree only when every selected step ran. A docs-only commit after a passing verdict reuses it.

import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { buildWorkingTree } from './build'
import { closeBrowsers, replayFonts } from './engines/browser'
import { evaluatorTouched } from './gate'
import { isRecord, parseJson } from './json'
import { holdMachine, holdSlot } from './lock'
import { appRoutes, routeConfig, routeProblems } from './probes/layout'
import { reusableVerdict } from './reuse'
import { selectBenches } from './scope'
import type { Selection } from './scope'
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

/**
 * The files a branch changes against staging, as the evaluator guard sees them: package.json counts as
 * `package.json#scripts` when its scripts changed (they define what `check` runs), and as nothing otherwise
 * (dependencies show in bun.lock)
 */
const changedForGuard = (repo: Repo): string[] => {
  const scripts = (ref: string): string => {
    try {
      const text = execFileSync(
        'git',
        ['-C', repo.top, 'show', `${ref}:package.json`],
        {
          encoding: 'utf-8',
        }
      )
      const value: unknown = JSON.parse(text)
      return JSON.stringify(isRecord(value) ? value.scripts : null)
    } catch {
      return ''
    }
  }
  return changedSince(repo, STAGING).flatMap((f) => {
    if (f !== 'package.json') {
      return [f]
    }
    const base = execFileSync(
      'git',
      ['-C', repo.top, 'merge-base', 'HEAD', STAGING],
      {
        encoding: 'utf-8',
      }
    ).trim()
    return scripts(base) === scripts('HEAD') ? [] : ['package.json#scripts']
  })
}

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
  /** Set when the verdict was stamped without a run: what it was reused from */
  reused: string | null
}

/** Every audit route: what the scope maps a change to (routes.json › skip gets no audit) */
const auditedRoutes = (): string[] => {
  const { skip } = routeConfig()
  return appRoutes().filter((r) => !(r in skip))
}

/** The selection, grouped by reason, so a reviewer sees what ran and why without 150 lines */
const describe = (selection: Selection, total: number): string => {
  const byWhy = new Map<string, number>()
  for (const why of selection.run.values()) {
    byWhy.set(why, (byWhy.get(why) ?? 0) + 1)
  }
  const head =
    selection.mode === 'full'
      ? `scope: full, all ${total} checks`
      : `scope: ${selection.run.size} of ${total} checks, from the diff against ${selection.base?.slice(0, 8) ?? '?'} (merge base with staging)`
  return [
    head,
    ...selection.why.map((w) => `  ${w}`),
    ...[...byWhy].map(([why, n]) => `  ${String(n).padStart(3)} × ${why}`),
  ].join('\n')
}

/** What a scoped check would run in this working tree, and why each, without running anything (`cli.ts scope`) */
export const scopeReport = (repo: Repo): string => {
  const exact = SUITE.filter(isExact)
  const selection = selectBenches(repo, exact, {
    audited: auditedRoutes(),
    full: false,
  })
  return [
    describe(selection, exact.length),
    '',
    ...[...selection.run].map(([id, why]) => `${id.padEnd(44)} ${why}`),
  ].join('\n')
}

/**
 * A docs-only commit after a passing verdict: stamp this tree with that verdict, noting where it came from, and run
 * nothing. Null when there is nothing to reuse
 */
const reuse = (repo: Repo, started: number): CheckResult | null => {
  const found = reusableVerdict(repo)
  if (found === null) {
    return null
  }
  if (found.verdict.tree === repo.tree) {
    process.stdout.write(
      `this tree already passed (${found.verdict.at}); nothing to run (--full runs everything again)\n`
    )
    return {
      reused: repo.tree,
      status: 'pass',
      steps: [],
      verdict: path.join(storeDir(repo, 'verdicts'), `${repo.tree}.json`),
      wallMs: Date.now() - started,
    }
  }
  const from = found.verdict.reused?.tree ?? found.verdict.tree
  const v: Verdict = {
    ...found.verdict,
    at: new Date().toISOString(),
    branch: repo.branch,
    reused: { files: found.files, sha: found.from, tree: from },
    sha: repo.sha,
    summary: `reused from ${from.slice(0, 8)}: only docs changed (${found.files.join(', ')})`,
    tree: repo.tree,
    wallMs: Date.now() - started,
  }
  process.stdout.write(`${v.summary}\n`)
  return {
    reused: from,
    status: 'pass',
    steps: [],
    verdict: writeVerdict(repo, v),
    wallMs: v.wallMs,
  }
}

/** The benchmarks this run measures: `--only`'s prefixes (no selection, no verdict), else the scope's selection */
const choose = (
  repo: Repo,
  exact: Benchmark[],
  opts: { only: string[] | null; full: boolean }
): { selection: Selection | null; selected: Benchmark[] } => {
  const { only } = opts
  if (only !== null) {
    return {
      selected: exact.filter((b) => only.some((o) => b.id.startsWith(o))),
      selection: null,
    }
  }
  const selection = selectBenches(repo, exact, {
    audited: auditedRoutes(),
    full: opts.full,
  })
  process.stdout.write(`${describe(selection, exact.length)}\n`)
  return { selected: exact.filter((b) => selection.run.has(b.id)), selection }
}

const scopeOf = (
  selection: Selection | null,
  total: number
): Verdict['scope'] =>
  selection === null
    ? undefined
    : {
        base: selection.base,
        mode: selection.mode,
        ran: Object.fromEntries(selection.run),
        skipped: total - selection.run.size,
        why: selection.why,
      }

const summaryOf = (
  steps: Step[],
  selection: Selection | null,
  total: number
): string => {
  const failures = steps.filter((s) => s.status === 'fail')
  if (failures.length > 0) {
    return failures
      .map((s) => `${s.name}: ${s.detail.split('\n')[0]}`)
      .join('; ')
  }
  return selection?.mode === 'scoped'
    ? `all checks pass (scoped: ${selection.run.size} of ${total})`
    : 'all checks pass'
}

export const runCheck = async (
  repo: Repo,
  opts: {
    only: string[] | null
    full: boolean
    jobs: number
    log: (m: string) => void
  }
): Promise<CheckResult> => {
  if (!Number.isInteger(opts.jobs) || opts.jobs < 1) {
    throw new Error(`--jobs must be a positive whole number, not ${opts.jobs}`)
  }
  const started = Date.now()
  // `--only`: the named audits, while working, no verdict. Otherwise every static check, and the audits the scope
  // selects (all of them with --full)
  const stamped = opts.only === null
  if (stamped && !opts.full) {
    const reused = reuse(repo, started)
    if (reused !== null) {
      return reused
    }
  }
  const steps: Step[] = []
  const say = (s: Step) => {
    steps.push(s)
    process.stdout.write(
      `${s.status === 'pass' ? 'ok  ' : 'FAIL'} ${s.name.padEnd(36)} ${(s.ms / 1000).toFixed(1).padStart(5)}s${s.detail === '' ? '' : `  ${s.detail.split('\n').join('\n      ')}`}\n`
    )
  }
  const failed = () => steps.some((s) => s.status === 'fail')
  const exact = SUITE.filter(isExact)
  const { selection, selected } = choose(repo, exact, opts)

  const phases = async (): Promise<void> => {
    if (stamped) {
      const t = Date.now()
      const touched = evaluatorTouched(changedForGuard(repo), (f) =>
        existedAt(repo, STAGING, f.replace(/#.*$/u, ''))
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
    {
      const t = Date.now()
      const problems = routeProblems()
      say({
        detail: problems.join('\n'),
        ms: Date.now() - t,
        name: 'audit list matches the router',
        status: problems.length === 0 ? 'pass' : 'fail',
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
    const statics = stamped
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
    const benches = selected
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
      // One retry, only for a run that produced nothing (a live YouTube player that never finished loading was
      // seen once in four runs). A count over budget is never re-rolled: a flaky layout bug fails
      let result = await once()
      let retried = ''
      if (result.sample === undefined) {
        retried = `retried after: ${result.problems.join('; ')}`
        result = await once()
      }
      const ok = result.problems.length === 0
      // On a pass, bytes show beside their budgets, so the headroom left is visible
      const headroom =
        bench.surface === null && result.sample !== undefined
          ? bench.metrics
              .map(
                (m) =>
                  `${m.key} ${result.sample?.values[m.key]?.toFixed(1)}/${budgets[bench.id]?.[m.key] ?? 0}`
              )
              .join(', ')
          : ''
      say({
        detail: ok
          ? [headroom, retried].filter(Boolean).join('; ')
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
    // `jobs` audits at a time, each in its own browser context and one of the machine's browser slots (lock.ts);
    // none starts after a failure. Timing audits come last, with the machine to themselves
    const queue = benches.filter((b) => b.surface !== null && b.timing !== true)
    const timed = benches.filter((b) => b.surface !== null && b.timing === true)
    const worker =
      (from: Benchmark[], slotted: boolean) => async (): Promise<void> => {
        for (let b = from.shift(); b && !failed(); b = from.shift()) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- each worker takes the next audit when it is free
          const release = slotted ? await holdSlot(repo, opts.log) : null
          try {
            // oxlint-disable-next-line eslint/no-await-in-loop -- one audit per slot
            await measureOne(b)
          } finally {
            release?.()
          }
        }
      }
    try {
      // Bytes first, alone: the cheapest check, and the commonest failure
      const size = benches.filter((b) => b.surface === null)
      for (const b of size) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one at a time, before any browser starts
        await measureOne(b)
      }
      await Promise.all(Array.from({ length: opts.jobs }, worker(queue, true)))
      if (timed.length > 0 && !failed()) {
        const t = Date.now()
        const release = await holdMachine(
          repo,
          `timing audits (${timed.map((b) => b.id).join(', ')})`,
          opts.log
        )
        opts.log(
          `the machine to itself for ${timed.length} timing audits after ${((Date.now() - t) / 1000).toFixed(1)}s`
        )
        try {
          await Promise.all(
            Array.from({ length: opts.jobs }, worker(timed, false))
          )
        } finally {
          release()
        }
      }
      process.stdout.write(
        `screenshots: ${storeDir(repo, 'bench', 'runs', runId)}\n`
      )
    } finally {
      server.stop()
      await closeBrowsers()
    }
  }
  await phases()

  // A pass must have run everything it claims: every expected step exactly once (a run that skipped the audits,
  // whatever the reason, is not a pass)
  if (!failed()) {
    const expected = [
      ...(stamped ? ['evaluator untouched by app changes', ...STATIC] : []),
      'audit list matches the router',
      'build',
      ...selected.map((b) => b.id),
    ]
    const ran = steps.map((s) => s.name)
    const missing = expected.filter(
      (n) => ran.filter((r) => r === n).length !== 1
    )
    const extra = ran.filter((r) => !expected.includes(r))
    if (
      missing.length > 0 ||
      extra.length > 0 ||
      ran.length !== expected.length
    ) {
      say({
        detail: `expected ${expected.length} steps, ran ${ran.length}; not run exactly once: ${missing.join(', ') || 'none'}${extra.length > 0 ? `; unexpected: ${extra.join(', ')}` : ''}`,
        ms: 0,
        name: 'every check ran',
        status: 'fail',
      })
    }
  }

  const status: Status = failed() ? 'fail' : 'pass'
  const wallMs = Date.now() - started
  let verdict: string | null = null
  if (stamped && !repo.dirty) {
    const v: Verdict = {
      at: new Date().toISOString(),
      branch: repo.branch,
      kind: 'check',
      repo: 'synbox',
      schema: 'harness/verdict@1',
      scope: scopeOf(selection, exact.length),
      sha: repo.sha,
      status,
      steps,
      summary: summaryOf(steps, selection, exact.length),
      tree: repo.tree,
      wallMs,
    }
    verdict = writeVerdict(repo, v)
  }
  return { reused: null, status, steps, verdict, wallMs }
}
