import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, test } from 'vite-plus/test'

// Every scrolling box shares one scrollbar look, set once in globals.css between `scrollbar:shared` and
// `scrollbar:shared:end`. A box may hide its bar (no-scrollbar, scrollbar-width: none, display: none), never give it
// a look of its own: that is how the Library menu came to show Windows' grey bar with arrows
const LOOK =
  /::-webkit-scrollbar-(?:thumb|track|button|corner)|scrollbar-color|scrollbar-width:\s*(?:thin|auto)|\[scrollbar-(?:color|width)|custom-scrollbar/gu

const SRC = path.resolve(import.meta.dirname)
const SHARED = /\/\* scrollbar:shared[\s\S]*?\/\* scrollbar:shared:end \*\//u
// Comments name things without styling them
const COMMENTS = /\/\*[\s\S]*?\*\/|(?<!:)\/\/.*$/gmu

test('scrollbars are styled in one place', () => {
  const found = readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.(?:tsx?|css)$/u.test(entry.name) &&
        !entry.name.endsWith('.test.ts')
    )
    .flatMap((entry) => {
      const file = path.join(entry.parentPath, entry.name)
      const text = readFileSync(file, 'utf-8')
        .replace(SHARED, '')
        .replace(COMMENTS, '')
      return [...text.matchAll(LOOK)].map(
        (match) => `${path.relative(SRC, file)}: ${match[0]}`
      )
    })
  expect(found).toEqual([])
})
