import { readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, test } from 'vite-plus/test'

import { isChecks, judge, parseReport } from './findings'
import type { Checks, RawFinding } from './findings'

// The shape report.json had on a real run (2.5.1, /privacy at 1440,390): findings per width, the sweep's carrying
// their own width, the 320px walk under `narrow`
const REPORT = {
  narrow: {
    findings: [
      {
        check: 'tap-size',
        crop: 'narrow-320-01-tap-size.jpg',
        fix: 'f',
        msg: 'm',
        sel: 'nav > button',
        sev: 'WARN',
        text: '',
        width: 320,
      },
    ],
    width: 320,
  },
  notCheckedAt: null,
  sweep: {
    findings: [
      {
        check: 'cut-text',
        fix: 'f',
        msg: 'm',
        sel: 'h1',
        sev: 'FAIL',
        text: 'Privacy',
        width: 1024,
      },
    ],
    widths: [1280, 1152, 1024, 896, 768],
  },
  widths: [
    {
      findings: [
        {
          check: 'focus-ring',
          crop: '',
          fix: 'f',
          msg: 'm',
          sel: ':focus-visible',
          sev: 'FAIL',
          stop: 0,
          text: '',
        },
        {
          check: 'cta',
          crop: '1440-01-cta.jpg',
          fix: 'f',
          msg: 'm',
          sel: 'main > div',
          sev: 'FAIL',
          stop: 0,
          text: '',
        },
      ],
      height: 900,
      width: 1440,
    },
    {
      findings: [
        {
          check: 'orphan',
          fix: 'f',
          msg: 'm',
          sel: 'p',
          sev: 'WARN',
          text: 'a b',
        },
      ],
      height: 844,
      width: 390,
    },
  ],
}

test('report.json: every block read, each finding at the width it was seen', () => {
  const { findings, notCheckedAt } = parseReport(REPORT)
  expect(findings.map((f) => [f.id, f.width, f.level, f.crop])).toEqual([
    ['focus-ring', 1440, 'FAIL', null],
    ['cta', 1440, 'FAIL', '1440-01-cta.jpg'],
    ['orphan', 390, 'WARN', null],
    ['cut-text', 1024, 'FAIL', null],
    ['tap-size', 320, 'WARN', 'narrow-320-01-tap-size.jpg'],
  ])
  expect(notCheckedAt).toEqual([])
  expect(parseReport({ ...REPORT, notCheckedAt: [390] }).notCheckedAt).toEqual([
    390,
  ])
})

test('a file that is not a checker report fails instead of reading as clean', () => {
  expect(() => parseReport({ checks: { cta: 'FAIL' } })).toThrow(/widths/u)
})

const CHECKS: Checks = {
  checker: {
    folder: 'skills/x',
    name: 'x',
    repo: 'o/x',
    sha: 'a'.repeat(40),
    version: '1',
  },
  checks: [
    { id: 'focus-ring', pages: 'all', verdict: 'adopt' },
    { id: 'field-label', pages: 'app', verdict: 'adapt' },
    { id: 'orphan', pages: 'prose', verdict: 'adapt' },
    { id: 'cta', pages: 'all', verdict: 'reject' },
  ],
  flags: [],
  pageKinds: { '/about': 'prose' },
}

const finding = (id: string, selector = 'main > input'): RawFinding => ({
  crop: null,
  fix: '',
  id,
  level: 'FAIL',
  message: '',
  selector,
  text: '',
  width: 1440,
})

test('kept: adopted or adapted, on a page of a kind the check covers, and not in the baseline', () => {
  const home = { kind: 'app' as const, name: 'home' }
  const about = { kind: 'prose' as const, name: 'about' }
  const player = { kind: 'player' as const, name: 'player' }
  const baseline = [
    { id: 'field-label', page: 'home', reason: 'r', selector: 'main > input' },
  ]
  expect(judge(CHECKS, [], player, finding('focus-ring'))).toEqual({
    kept: true,
    verdict: 'adopt',
  })
  expect(judge(CHECKS, [], home, finding('cta'))).toEqual({
    kept: false,
    why: 'rejected',
  })
  expect(judge(CHECKS, [], about, finding('field-label'))).toEqual({
    kept: false,
    why: 'out-of-scope',
  })
  expect(judge(CHECKS, [], home, finding('orphan'))).toEqual({
    kept: false,
    why: 'out-of-scope',
  })
  expect(judge(CHECKS, [], about, finding('orphan'))).toEqual({
    kept: true,
    verdict: 'adapt',
  })
  expect(judge(CHECKS, [], home, finding('new-check'))).toEqual({
    kept: false,
    why: 'unknown',
  })
  expect(judge(CHECKS, baseline, home, finding('field-label'))).toEqual({
    kept: false,
    why: 'baselined',
  })
  // A baseline entry accepts that finding only: another element, or the same one on another page, is still kept
  expect(
    judge(CHECKS, baseline, home, finding('field-label', 'nav > input'))
  ).toEqual({ kept: true, verdict: 'adapt' })
  expect(
    judge(
      CHECKS,
      baseline,
      { kind: 'app', name: 'library' },
      finding('field-label')
    )
  ).toEqual({ kept: true, verdict: 'adapt' })
})

test('harness/taste/checks.json is readable and names each check once', () => {
  const v: unknown = JSON.parse(
    readFileSync(path.join(import.meta.dirname, 'checks.json'), 'utf-8')
  )
  expect(isChecks(v)).toBe(true)
  const ids = isChecks(v) ? v.checks.map((c) => c.id) : []
  expect(ids.length).toBe(new Set(ids).size)
})
