import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, test } from 'vite-plus/test'

import { isRecord } from './json'
import { isDocs } from './reuse'
import { pageMap, routeModules, selectBenches } from './scope'
import type { Repo } from './store'
import type { Benchmark } from './types'

const top = path.resolve(import.meta.dirname, '../..')
// The routes the layout audits visit: src/app.tsx's, minus harness/routes.json › skip (probes/layout.ts reads them
// through Bun's import.meta.dir, which the test runner lacks)
const audited = () => {
  const config: unknown = JSON.parse(
    readFileSync(path.join(top, 'harness', 'routes.json'), 'utf-8')
  )
  const skip =
    isRecord(config) && isRecord(config.skip) ? Object.keys(config.skip) : []
  return [...routeModules(top).routes.keys()].filter((r) => !skip.includes(r))
}
// Benchmarks shaped like suite.ts's (which can't load under the test runner: it reads routes through Bun)
const bench = (
  id: string,
  routes: string[],
  probe: string,
  shell?: string[]
): Benchmark => ({
  id,
  metrics: [],
  run: async () => await Promise.resolve({ errors: [], samples: [] }),
  runs: 1,
  scope: {
    probe: `harness/bench/probes/${probe}.ts`,
    routes,
    ...(shell === undefined ? {} : { shell }),
  },
  surface: null,
  title: id,
})
const TOP_BAR = 'src/components/shared/top-bar.tsx'
const BENCHES: Benchmark[] = [
  { ...bench('size', [], 'size'), scope: 'always' },
  bench('layout-home-web', ['/'], 'layout'),
  bench('layout-player-web', ['/v/:videoId'], 'layout'),
  bench('layout-privacy-web', ['/privacy'], 'layout'),
  bench('keyboard-journey', ['/', '/v/:videoId', '/search'], 'keyboard'),
  bench('lyric-dock-web', ['/v/:videoId'], 'lyric-dock', []),
  bench('lyric-shift-web', ['/v/:videoId'], 'lyric-shift', [TOP_BAR]),
]
const repo: Repo = {
  branch: 'test',
  dirty: true,
  main: top,
  sha: 'head',
  top,
  tree: 'tree',
}
const select = (files: string[], exports?: Map<string, Set<string> | 'all'>) =>
  selectBenches(repo, BENCHES, {
    audited: audited(),
    changed: { base: 'base', exports, files },
    full: false,
  })
const ran = (s: ReturnType<typeof select>) => [...s.run.keys()].toSorted()

describe('scope', () => {
  test('every audited route maps to its page module through src/app.tsx', () => {
    const { routes } = routeModules(top)
    for (const route of audited()) {
      expect(routes.get(route), route).toMatch(/^src\/.+\.tsx$/u)
    }
  })

  test('a page-only module narrows to its page; the stylesheet and root layout are every page', () => {
    const map = pageMap(top, audited())
    expect(map.unmapped).toEqual([])
    const landing = 'src/_root/pages/landing-page.tsx'
    expect(map.shell.has(landing)).toBe(false)
    expect(
      [...map.pages].filter(([, mods]) => mods.has(landing)).map(([r]) => r)
    ).toEqual(['/'])
    expect(map.shell.has('src/globals.css')).toBe(true)
    expect(map.shell.has('src/_root/root-layout.tsx')).toBe(true)
  })

  test('a copy change in a home component runs home and the journey through it, not the player', () => {
    const s = select([
      'src/components/generate-lyrics/hero-generate-lyrics-default.tsx',
    ])
    expect([...s.run.keys()].toSorted()).toEqual([
      'keyboard-journey',
      'layout-home-web',
      'size',
    ])
  })

  test('a top-bar change runs every page and the audits that observe the top bar, not the stage-only ones', () => {
    expect(ran(select(['src/components/topbar/profile-button.tsx']))).toEqual([
      'keyboard-journey',
      'layout-home-web',
      'layout-player-web',
      'layout-privacy-web',
      'lyric-shift-web',
      'size',
    ])
  })

  test("a change inside the player's stage runs its timing audits", () => {
    const s = select(['src/components/player-stage/stage-lyrics.tsx'])
    expect(s.run.has('lyric-dock-web')).toBe(true)
    expect(s.run.has('layout-home-web')).toBe(false)
  })

  test("a new export in a module the player imports reaches only that export's importers", () => {
    // src/lib/auth.ts is imported by the player's stage; the importers of the new export are not
    const auth = 'src/lib/auth.ts'
    const whole = ran(select([auth]))
    expect(whole).toContain('lyric-dock-web')
    const narrowed = select(
      [auth],
      new Map([[auth, new Set(['NOT_IMPORTED_ANYWHERE'])]])
    )
    expect(ran(narrowed)).toEqual(['size'])
    expect(narrowed.why[0]).toMatch(/only NOT_IMPORTED_ANYWHERE changed/u)
    // An export the stage does import still reaches it
    const used = select([auth], new Map([[auth, new Set(['useAccess'])]]))
    expect(
      used.run.has('lyric-dock-web') || used.run.has('lyric-shift-web')
    ).toBe(true)
  })

  test('the stylesheet, a build file or the check itself runs everything', () => {
    for (const file of [
      'src/globals.css',
      'vite.config.ts',
      'harness/bench/check.ts',
    ]) {
      expect(select([file]).run.size, file).toBe(BENCHES.length)
    }
  })

  test('a probe change runs that probe and the probes that import it', () => {
    expect([
      ...select(['harness/bench/probes/lyric-dock.ts']).run.keys(),
    ]).toEqual(['size', 'lyric-dock-web'])
    // layout.ts holds the player's readiness, which lyric-dock imports
    expect(
      select(['harness/bench/probes/layout.ts']).run.has('lyric-dock-web')
    ).toBe(true)
  })

  test('docs alone run nothing but what always runs', () => {
    expect([...select(['docs/log/x.md', 'AGENTS.md']).run.keys()]).toEqual([
      'size',
    ])
  })

  test('only prose outside src/ and public/ counts as docs', () => {
    expect(isDocs('docs/log/2026-10-27-x.md')).toBe(true)
    expect(isDocs('harness/README.md')).toBe(true)
    expect(isDocs('src/components/notes.md')).toBe(false)
    expect(isDocs('public/terms.md')).toBe(false)
    expect(isDocs('harness/budgets.json')).toBe(false)
  })
})
