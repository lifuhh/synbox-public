// Page loads and flows through cdp-perf (the frontend-perf skill's CLI): trace-based Web Vitals, measured the way
// its README documents. The bench takes cdp-perf's per-run values as its samples and keeps its findings beside them.

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { isRecord, parseJson } from '../json'
import type { BenchContext, Sample } from '../types'

const candidates = [
  process.env.CDP_PERF,
  path.join(homedir(), '.claude/skills/frontend-perf/scripts/cdp-perf'),
].filter((p): p is string => Boolean(p))

export const cdpPerfBin = (): string | null =>
  candidates.find((p) => existsSync(p)) ?? null

interface CdpReport {
  runs: { error?: string; metrics: Record<string, number> }[]
  findings: { id: string; severity: string; title: string }[]
  warnings: string[]
}

const isCdpReport = (v: unknown): v is CdpReport =>
  isRecord(v) &&
  Array.isArray(v.runs) &&
  Array.isArray(v.findings) &&
  Array.isArray(v.warnings)

/**
 * One cdp-perf invocation of `runs` runs (plus its warm-up); returns one Sample per successful run. Spawned
 * asynchronously: the bench server answering its requests runs in this process.
 */
export const cdpPerf = async (
  ctx: BenchContext,
  opts: {
    path: string
    runs: number
    flags: string[]
    flow?: object
    pick: Record<string, string>
  }
): Promise<Sample[]> => {
  const bin = cdpPerfBin()
  if (bin === null) {
    throw new Error(
      'cdp-perf not found: install the frontend-perf skill or set CDP_PERF to its launcher'
    )
  }
  const url = `${ctx.origin}${opts.path}`
  const args = opts.flow ? ['flow'] : ['perf', url]
  if (opts.flow) {
    const file = path.join(ctx.artifactDir, 'flow.json')
    writeFileSync(file, JSON.stringify({ ...opts.flow, url }))
    args.push(file)
  }
  args.push(
    '--runs',
    String(opts.runs),
    '--warmup',
    String(ctx.warmup),
    '--out-dir',
    ctx.artifactDir,
    '--block',
    '*://*.sentry.io/*',
    ...opts.flags
  )
  try {
    // oxlint-disable-next-line typescript/strict-void-return -- promisify takes Node's callback-style execFile; the ChildProcess it returns goes unused
    await promisify(execFile)(bin, args, {
      maxBuffer: 64 * 1024 * 1024,
      timeout: 20 * 60_000,
    })
  } catch (error) {
    // Exit 1 with a report on disk means some runs failed; anything else is fatal
    if (!existsSync(path.join(ctx.artifactDir, 'report.json'))) {
      throw error
    }
  }
  const report = parseJson(
    readFileSync(path.join(ctx.artifactDir, 'report.json'), 'utf-8'),
    isCdpReport,
    'cdp-perf report.json'
  )
  const top = report.findings
    .slice(0, 3)
    .map((f) => `${f.severity} ${f.id}: ${f.title}`)
  return report.runs
    .filter((r) => (r.error ?? '') === '')
    .map((r, i) => ({
      notes: i === 0 ? [...top, ...report.warnings.slice(0, 3)] : undefined,
      values: Object.fromEntries(
        Object.entries(opts.pick).flatMap(([key, src]) =>
          typeof r.metrics[src] === 'number' ? [[key, r.metrics[src]]] : []
        )
      ),
    }))
}
