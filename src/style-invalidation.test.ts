import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, test } from 'vite-plus/test'

// Utilities whose CSS makes one inserted element restyle the whole document: ~30ms per insertion on the home page in
// WebKit, ~7ms in Chromium (desktop, unthrottled), so every gallery row, lyric line and render dropped frames on a phone
const BANNED = [
  // `:where(.space-y-N > :not(:last-child))`: nothing but the pseudo-class on the right, so WebKit checks it on every
  // element and treats every parent as depending on its last child. Use flex or grid with gap
  { pattern: /(?<![\w-])(?:[\w-]+:)*-?space-[xy]-/gu, why: 'use gap' },
  // `.group:has(:focus-visible) *`: with the html:has() rules, Chromium invalidates the whole tree on every
  // insertion. Use group-focus-within
  {
    pattern: /(?<![\w-])(?:[\w-]+:)*group-has-/gu,
    why: 'use group-focus-within',
  },
]

const SRC = path.resolve(import.meta.dirname)

const sources = (): string[] =>
  readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.(?:tsx?|css)$/u.test(entry.name) &&
        !entry.name.endsWith('.test.ts')
    )
    .map((entry) => path.join(entry.parentPath, entry.name))

test('no utility that restyles the whole document on every insertion', () => {
  const found = sources().flatMap((file) => {
    const text = readFileSync(file, 'utf-8')
    return BANNED.flatMap(({ pattern, why }) =>
      [...text.matchAll(pattern)].map(
        (match) => `${path.relative(SRC, file)}: ${match[0]} (${why})`
      )
    )
  })
  expect(found).toEqual([])
})
