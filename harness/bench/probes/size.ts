// Bytes the build ships, compressed as Netlify serves them (brotli). Exact and free to measure, and the
// cheapest early warning there is: most load regressions start as a bigger first bundle.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { brotliCompressSync } from 'node:zlib'

import type { BenchContext, Sample } from '../types'

const kb = (file: string) =>
  brotliCompressSync(readFileSync(file)).length / 1024

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

const sum = (fs: string[]) => fs.reduce((s, f) => s + kb(f), 0)

export const buildSize = async (
  ctx: BenchContext
): Promise<{ samples: Sample[]; errors: string[] }> => {
  const html = await readFile(path.join(ctx.distDir, 'index.html'), 'utf-8')
  // What the first page load fetches before anything runs: the entry script, its modulepreloads and stylesheets
  const initial = [
    ...html.matchAll(/(?:src|href)="(?<asset>\/assets\/[^"]+\.(?:js|css))"/gu),
  ].map((m) => path.join(ctx.distDir, m[1]))
  const files = walk(ctx.distDir).filter((f) => !f.endsWith('.map'))
  const values = {
    allJsKB: sum(
      files.filter((f) => f.endsWith('.js') && f.includes('/assets/'))
    ),
    cssKB: sum(initial.filter((f) => f.endsWith('.css'))),
    initialJsKB: sum(initial.filter((f) => f.endsWith('.js'))),
  }
  return {
    errors: [],
    samples: [{ notes: initial.map((f) => path.basename(f)), values }],
  }
}
