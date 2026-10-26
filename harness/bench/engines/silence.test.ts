import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, test } from 'vite-plus/test'

const HARNESS = path.resolve(import.meta.dirname, '../..')
const BROWSER = path.join(HARNESS, 'bench/engines/browser.ts')
const LAUNCHES =
  /\b(?:chromium|webkit|firefox)\.launch|\.launchPersistentContext\(|\.newContext\(|\.connectOverCDP\(/u

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : sources(full)
    }
    return /\.tsx?$/u.test(entry.name) && !entry.name.endsWith('.test.ts')
      ? [full]
      : []
  })

// WebKit has no mute flag: a browser opened anywhere but engines/browser.ts › open plays the YouTube embed aloud
test('only engines/browser.ts launches a browser or opens a context', () => {
  const offenders = sources(HARNESS).filter(
    (file) => file !== BROWSER && LAUNCHES.test(readFileSync(file, 'utf-8'))
  )
  expect(offenders).toEqual([])
})

test('every context engines/browser.ts opens is silenced before its first page', () => {
  const source = readFileSync(BROWSER, 'utf-8')
  const contexts = source.match(/\.newContext\(/gu) ?? []
  const silenced = source.match(/addInitScript\(silenceAllMedia\)/gu) ?? []
  expect(silenced.length).toBeGreaterThanOrEqual(contexts.length)
  expect(source.indexOf('addInitScript(silenceAllMedia)')).toBeLessThan(
    source.indexOf('.newPage(')
  )
})
