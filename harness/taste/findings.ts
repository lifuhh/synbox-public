// What harness/taste.ts keeps from the taste checker's report: its findings read from report.json, judged against
// harness/taste/checks.json (a verdict and the page kinds per check id) and harness/taste/baseline.json (findings
// accepted with a reason). Pure: no files, no processes, so the filter is tested on its own (findings.test.ts).

import { isRecord } from '../bench/json'

export type Kind = 'app' | 'player' | 'prose' | 'admin'
export type Verdict = 'adopt' | 'adapt' | 'reject'
export type Level = 'FAIL' | 'WARN'

export interface CheckRule {
  id: string
  verdict: Verdict
  /** The page kinds the check applies to */
  pages: 'all' | Kind
}

export interface Checks {
  checker: {
    name: string
    version: string
    sha: string
    repo: string
    folder: string
  }
  /** A route's kind, as written in src/app.tsx; any other route is `app` */
  pageKinds: Record<string, Kind>
  flags: { flag: string; use: boolean }[]
  checks: CheckRule[]
}

/** One finding as the checker reported it */
export interface RawFinding {
  width: number
  id: string
  level: Level
  selector: string
  text: string
  message: string
  fix: string
  /** The crop's file name, beside report.json */
  crop: string | null
}

export interface Finding extends RawFinding {
  page: string
  verdict: 'adopt' | 'adapt'
}

export interface BaselineEntry {
  page: string
  id: string
  selector: string
  reason: string
}

export interface Report {
  findings: RawFinding[]
  /** Widths the checker could not walk: nothing it says about them is a pass */
  notCheckedAt: number[]
}

const KINDS = new Set<string>(['app', 'player', 'prose', 'admin'])
const VERDICTS = new Set<string>(['adopt', 'adapt', 'reject'])

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const isCheckRule = (v: unknown): v is CheckRule =>
  isRecord(v) &&
  typeof v.id === 'string' &&
  typeof v.verdict === 'string' &&
  VERDICTS.has(v.verdict) &&
  typeof v.pages === 'string' &&
  (v.pages === 'all' || KINDS.has(v.pages))

export const isChecks = (v: unknown): v is Checks =>
  isRecord(v) &&
  isRecord(v.checker) &&
  typeof v.checker.sha === 'string' &&
  /^[0-9a-f]{40}$/u.test(v.checker.sha) &&
  typeof v.checker.version === 'string' &&
  isRecord(v.pageKinds) &&
  Object.values(v.pageKinds).every(
    (k) => typeof k === 'string' && KINDS.has(k)
  ) &&
  Array.isArray(v.flags) &&
  v.flags.every(
    (f) =>
      isRecord(f) && typeof f.flag === 'string' && typeof f.use === 'boolean'
  ) &&
  Array.isArray(v.checks) &&
  v.checks.every(isCheckRule)

export const isBaseline = (v: unknown): v is { entries: BaselineEntry[] } =>
  isRecord(v) &&
  Array.isArray(v.entries) &&
  v.entries.every(
    (e) =>
      isRecord(e) &&
      ['page', 'id', 'selector', 'reason'].every(
        (k) => typeof e[k] === 'string' && e[k] !== ''
      )
  )

const rawFinding = (x: unknown, width: number): RawFinding | null => {
  if (!isRecord(x) || typeof x.check !== 'string') {
    return null
  }
  return {
    crop: typeof x.crop === 'string' && x.crop !== '' ? x.crop : null,
    fix: str(x.fix),
    id: x.check,
    level: x.sev === 'FAIL' ? 'FAIL' : 'WARN',
    message: str(x.msg),
    selector: str(x.sel),
    text: str(x.text),
    width: typeof x.width === 'number' ? x.width : width,
  }
}

const findingsOf = (block: unknown, width: number): RawFinding[] =>
  isRecord(block) && Array.isArray(block.findings)
    ? block.findings.flatMap((x) => rawFinding(x, width) ?? [])
    : []

/**
 * The checker's report.json: one block per width walked (`widths`), the first-screen sweep (`sweep`, each finding
 * naming its width) and the 320px walk (`narrow`). A report with no `widths` list is not the checker's
 */
export const parseReport = (report: unknown): Report => {
  if (!isRecord(report) || !Array.isArray(report.widths)) {
    throw new Error(
      'report.json has no `widths` list: not a taste checker report'
    )
  }
  const widths = report.widths.flatMap((w) =>
    isRecord(w) && typeof w.width === 'number' ? [w] : []
  )
  const narrowWidth =
    isRecord(report.narrow) && typeof report.narrow.width === 'number'
      ? report.narrow.width
      : 320
  return {
    findings: [
      ...widths.flatMap((w) => findingsOf(w, Number(w.width))),
      ...findingsOf(report.sweep, 0),
      ...findingsOf(report.narrow, narrowWidth),
    ],
    notCheckedAt: Array.isArray(report.notCheckedAt)
      ? report.notCheckedAt.filter((w): w is number => typeof w === 'number')
      : [],
  }
}

export const kindOf = (checks: Checks, route: string): Kind =>
  checks.pageKinds[route] ?? 'app'

/** Why a finding was not kept, or its verdict when it was */
export type Judgement =
  | { kept: true; verdict: 'adopt' | 'adapt' }
  | { kept: false; why: 'rejected' | 'out-of-scope' | 'unknown' | 'baselined' }

export const judge = (
  checks: Checks,
  baseline: BaselineEntry[],
  page: { name: string; kind: Kind },
  finding: RawFinding
): Judgement => {
  const rule = checks.checks.find((c) => c.id === finding.id)
  if (rule === undefined) {
    return { kept: false, why: 'unknown' }
  }
  if (rule.verdict === 'reject') {
    return { kept: false, why: 'rejected' }
  }
  if (rule.pages !== 'all' && rule.pages !== page.kind) {
    return { kept: false, why: 'out-of-scope' }
  }
  const accepted = baseline.some(
    (b) =>
      b.page === page.name &&
      b.id === finding.id &&
      b.selector === finding.selector
  )
  return accepted
    ? { kept: false, why: 'baselined' }
    : { kept: true, verdict: rule.verdict }
}

/** A finding's identity across scans: what it is and where, not its wording */
export const findingKey = (f: Finding): string =>
  [f.page, f.width, f.id, f.selector, f.text].join('\u0000')

export interface Diff {
  added: Finding[]
  gone: Finding[]
}

export const diffScans = (before: Finding[], after: Finding[]): Diff => {
  const was = new Set(before.map(findingKey))
  const is = new Set(after.map(findingKey))
  return {
    added: after.filter((f) => !was.has(findingKey(f))),
    gone: before.filter((f) => !is.has(findingKey(f))),
  }
}
