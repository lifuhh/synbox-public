import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, test } from 'vite-plus/test'

// Every row that scrolls sideways takes a mouse wheel (hooks/wheel-sideways.ts), or says why its wheel stays
// native. Rows added without it were how a desktop mouse came to scroll some rows and not others
const SRC = path.resolve(import.meta.dirname)

test('every sideways row takes the mouse wheel or says why not', () => {
  const missing = readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .flatMap((file) => {
      const text = readFileSync(file, 'utf-8')
      const rows = text.match(/overflow-x-auto/gu)?.length ?? 0
      const handled =
        (text.match(/wheelSideways[(}]/gu)?.length ?? 0) +
        (text.match(/wheel stays native/giu)?.length ?? 0)
      return rows > handled
        ? [`${path.relative(SRC, file)}: ${rows} rows, ${handled} handled`]
        : []
    })
  expect(missing).toEqual([])
})
