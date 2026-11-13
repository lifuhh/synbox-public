import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, test } from 'vite-plus/test'

// A selector given to matches(), querySelector() or closest() throws on a browser that can't parse it, and the throw
// takes the page down: a `:has()` in search-dock.tsx did that on Chrome before 105. CSS only drops a rule it can't
// parse, so `:has()` belongs in stylesheets (or Tailwind's `has-*` variants), never in a script's selector
const HAS = /:has\(/gu

const SRC = path.resolve(import.meta.dirname)
// Comments name things without selecting them
const COMMENTS = /\/\*[\s\S]*?\*\/|(?<!:)\/\/.*$/gmu

test('scripts select without :has()', () => {
  const found = readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.tsx?$/u.test(entry.name) &&
        !entry.name.endsWith('.test.ts')
    )
    .flatMap((entry) => {
      const file = path.join(entry.parentPath, entry.name)
      const text = readFileSync(file, 'utf-8').replace(COMMENTS, '')
      return [...text.matchAll(HAS)].map(() => path.relative(SRC, file))
    })
  expect(found).toEqual([])
})
