import { describe, expect, test } from 'vite-plus/test'

import { evaluatorTouched } from './gate'

const existed = () => true

describe('evaluatorTouched', () => {
  test('a probe edited beside app code is refused', () => {
    expect(
      evaluatorTouched(
        ['harness/bench/probes/layout.ts', 'src/app.tsx'],
        existed
      )
    ).toContain('harness/bench/probes/layout.ts')
  })

  test('a metric spec edited beside a dependency bump is refused', () => {
    expect(
      evaluatorTouched(['harness/bench/suite.ts', 'bun.lock'], existed)
    ).not.toBeNull()
  })

  test('a check step switched off in package.json beside app code is refused', () => {
    expect(
      evaluatorTouched(['package.json#scripts', 'src/app.tsx'], existed)
    ).not.toBeNull()
  })

  test('the audit engine edited beside app code is refused, trend.ts is not the evaluator', () => {
    expect(
      evaluatorTouched(
        ['harness/bench/engines/recorder.ts', 'src/app.tsx'],
        existed
      )
    ).not.toBeNull()
    expect(
      evaluatorTouched(['harness/bench/trend.ts', 'src/app.tsx'], existed)
    ).toBeNull()
  })

  test('a budget raised beside the app change that needs it passes', () => {
    expect(
      evaluatorTouched(['harness/budgets.json', 'src/app.tsx'], existed)
    ).toBeNull()
  })

  test('a probe added for the first time is not an edit', () => {
    expect(
      evaluatorTouched(
        ['harness/bench/probes/new.ts', 'src/app.tsx'],
        (f) => f !== 'harness/bench/probes/new.ts'
      )
    ).toBeNull()
  })
})
