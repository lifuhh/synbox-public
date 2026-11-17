import { mkdirSync, mkdtempSync, readdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, test } from 'vite-plus/test'

import { pruneOlderThan } from './retention'

test('folders past the age go with their contents; newer ones stay', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'retention-'))
  const now = Date.now()
  const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000)
  for (const [name, age] of [
    ['old', 5],
    ['edge', 2.9],
    ['new', 0],
  ] as const) {
    mkdirSync(path.join(dir, name, 'shots'), { recursive: true })
    utimesSync(path.join(dir, name), daysAgo(age), daysAgo(age))
  }
  expect(pruneOlderThan(dir, 3, now)).toBe(1)
  expect(readdirSync(dir).toSorted()).toEqual(['edge', 'new'])
})
