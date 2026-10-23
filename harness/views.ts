// One page in all views: web (Chromium 1440×900), PWA portrait and PWA landscape (WebKit 390×844 and 844×390,
// installed, iPhone safe areas). Each view gets the layout audit `check` runs (harness/bench/probes/layout.ts), and
// one .reports/ page shows the three screenshots side by side.
//
//   bun harness/views.ts <path-or-url>                          this working tree's production build, served by the bench
//   bun harness/views.ts <path> --port N                        whatever already serves http://localhost:N (`wt serve`)
//   bun harness/views.ts <path-or-url> --compare <base>         before/after rows; <base> is a URL or origin
//                                                               (https://synbox.io) or a git ref (origin/staging)
//   bun harness/views.ts <path-or-url> --state <name>           with one of the route's opened states open
//                                                               (probes/layout.ts › OPENED_STATES), in its views
//
// Exits 3 when a view has a finding or failed to open, so a script can gate on it.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { buildRef, buildWorkingTree } from './bench/build'
import {
  ALL_VIEWS,
  closeBrowsers,
  replayFonts,
  VIEWPORTS,
} from './bench/engines/browser'
import type { View } from './bench/engines/browser'
import { auditPage, LAYOUT_FINDINGS, pageAt } from './bench/probes/layout'
import type { OpenedState } from './bench/probes/layout'
import { serveBuild } from './bench/server'
import type { BenchServer } from './bench/server'
import { repoAt, storeDir } from './bench/store'
import type { Repo } from './bench/store'
import type { Sample } from './bench/types'

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    compare: { type: 'string' },
    port: { type: 'string' },
    state: { type: 'string' },
  },
})

const log = (m: string): void => {
  process.stderr.write(`· ${m}\n`)
}

const isUrl = (s: string) => /^https?:\/\//u.test(s)

const servers: BenchServer[] = []

const serve = (repo: Repo, dist: string): string => {
  const server = serveBuild({
    distDir: dist,
    fixturesDir: storeDir(repo, 'bench', 'fixtures'),
    mode: 'replay',
    repoTop: repo.top,
  })
  servers.push(server)
  return server.origin
}

/** The page under review: a URL as given, a path on --port, or a path on this working tree's build */
const afterUrl = async (repo: Repo, target: string): Promise<URL> => {
  if (isUrl(target)) {
    return new URL(target)
  }
  if (flags.port !== undefined) {
    if (!/^\d+$/u.test(flags.port)) {
      throw new Error(`--port must be a number, not "${flags.port}"`)
    }
    return new URL(target, `http://localhost:${flags.port}`)
  }
  return new URL(target, serve(repo, await buildWorkingTree(repo, log)))
}

/** The same page before: <base> a page URL as given, an origin with the page's path, or a git ref's build */
const beforeUrl = async (
  repo: Repo,
  base: string,
  after: URL
): Promise<URL> => {
  const page = `${after.pathname}${after.search}`
  if (isUrl(base)) {
    const url = new URL(base)
    return url.pathname === '/' && url.search === ''
      ? new URL(page, url.origin)
      : url
  }
  const sha = execFileSync('git', ['-C', repo.top, 'rev-parse', base], {
    encoding: 'utf-8',
  }).trim()
  const { dist } = await buildRef(repo, sha, log)
  return new URL(page, serve(repo, dist))
}

interface Shot {
  view: View
  file: string
  findings: string[]
  notes: string[]
}

const shoot = async (
  url: URL,
  view: View,
  dir: string,
  prefix: string,
  state?: OpenedState
): Promise<Shot> => {
  const file = `${prefix}-${view.name}${state ? `+${state.name}` : ''}.png`
  const { samples, errors } = await auditPage(
    pageAt(url),
    view.surface,
    url.href,
    path.join(dir, file),
    state
  )
  const [sample]: (Sample | undefined)[] = samples
  if (sample === undefined) {
    return {
      file,
      findings: [`no audit: ${errors[0] ?? 'unknown error'}`],
      notes: [],
      view,
    }
  }
  return {
    file,
    findings: LAYOUT_FINDINGS.filter((k) => (sample.values[k] ?? 0) > 0).map(
      (k) => `${k} ${sample.values[k]}`
    ),
    notes: sample.notes ?? [],
    view,
  }
}

const escape = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const figure = (shot: Shot, side: string) => `
  <figure>
    <a href="${shot.file}"><img src="${shot.file}" alt="${escape(`${side}${shot.view.name}`)}"></a>
    <figcaption>
      <b>${side}${shot.view.name}</b> · ${escape(shot.view.label)} ·
      <span class="${shot.findings.length > 0 ? 'bad' : 'ok'}">${escape(shot.findings.join(', ') || 'no findings')}</span>
      ${shot.notes.length > 0 ? `<ul>${shot.notes.map((n) => `<li>${escape(n)}</li>`).join('')}</ul>` : ''}
    </figcaption>
  </figure>`

const html = (title: string, rows: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  body { margin: 0; padding: 16px; background: #111; color: #ddd; font: 14px/1.4 system-ui, sans-serif; }
  h1 { font-size: 16px; font-weight: 600; margin: 0 0 16px; }
  .row { display: grid; gap: 16px; align-items: start; margin-bottom: 24px; }
  .pair { grid-template-columns: 1fr 1fr; }
  figure { margin: 0; min-width: 0; }
  img { display: block; width: 100%; height: auto; border: 1px solid #333; }
  figcaption { margin-top: 6px; }
  .ok { color: #7c7; } .bad { color: #f77; }
  ul { margin: 4px 0 0; padding-left: 18px; color: #aaa; font-size: 12px; }
  @media (width < 900px) { .row { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>${escape(title)}</h1>
${rows}
</body>
</html>
`

const report = (shot: Shot, side: string) => {
  const status = shot.findings.length > 0 ? shot.findings.join(', ') : 'ok'
  process.stdout.write(
    `${`${side}${shot.view.name}`.padEnd(22)} ${shot.view.label.padEnd(36)} ${status}\n${shot.notes.map((n) => `    ${n}\n`).join('')}`
  )
}

const main = async () => {
  const [target] = positionals
  if (target === undefined) {
    throw new Error(
      'usage: bun harness/views.ts <path-or-url> [--port N] [--compare <base-url|git-ref>] [--state <name>]'
    )
  }
  const repo = repoAt(process.cwd())
  const page = pageAt(new URL(target, 'http://localhost'))
  const state =
    flags.state === undefined
      ? undefined
      : page.states?.find((st) => st.name === flags.state)
  if (flags.state !== undefined && state === undefined) {
    throw new Error(
      `no opened state "${flags.state}" for ${target}; its states: ${page.states?.map((st) => st.name).join(', ') ?? 'none'}`
    )
  }
  // A state is opened only in the views it names
  const views = ALL_VIEWS.filter(
    (v) => state?.views === undefined || state.views.includes(v.name)
  )
  replayFonts(storeDir(repo, 'bench', 'fixtures', 'fonts'))
  const after = await afterUrl(repo, target)
  const before =
    flags.compare === undefined
      ? null
      : await beforeUrl(repo, flags.compare, after)
  const slug =
    `${after.pathname}${after.search}`
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, '-')
      .replaceAll(/^-|-$/gu, '')
      .slice(0, 40) || 'home'
  const day = new Date().toLocaleDateString('en-CA')
  const dir = path.join(
    repo.top,
    '.reports',
    `${day}-views-${slug}${state ? `-${state.name}` : ''}`
  )
  mkdirSync(dir, { recursive: true })

  const sides = before === null ? [after] : [before, after]
  // Every view of every side at once, like `check`'s parallel audits: each in its own browser context
  const shots = await Promise.all(
    sides.flatMap((url, i) =>
      views.map(
        async (view) =>
          await shoot(
            url,
            view,
            dir,
            before === null ? 'view' : ['before', 'after'][i],
            state
          )
      )
    )
  )
  const n = views.length
  let rows: string
  if (before === null) {
    for (const s of shots) {
      report(s, '')
    }
    // Each screenshot as wide as its screen, side by side
    const columns = views
      .map(({ surface }) =>
        surface.kind === 'phone'
          ? `${VIEWPORTS[surface.orientation].width}fr`
          : `${VIEWPORTS.desktop.width}fr`
      )
      .join(' ')
    rows = `<div class="row" style="grid-template-columns: ${columns}">${shots.map((s) => figure(s, '')).join('')}</div>`
  } else {
    const pairs = views.map((_, i) => [shots[i], shots[n + i]] as const)
    for (const [b, a] of pairs) {
      report(b, 'before ')
      report(a, 'after  ')
    }
    rows = pairs
      .map(
        ([b, a]) =>
          `<div class="row pair">${figure(b, 'before · ')}${figure(a, 'after · ')}</div>`
      )
      .join('')
  }
  const opened = state ? ` with ${state.name} open` : ''
  const title =
    before === null
      ? `All views: ${after.href}${opened}`
      : `All views: ${before.href} → ${after.href}${opened}`
  const index = path.join(dir, 'index.html')
  writeFileSync(index, html(title, rows))
  process.stdout.write(`\n${index}\n`)
  process.exitCode = shots.some((s) => s.findings.length > 0) ? 3 : 0
}

try {
  await main()
} catch (error) {
  process.stderr.write(
    `views: ${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exitCode = 1
} finally {
  for (const s of servers) {
    s.stop()
  }
  await closeBrowsers()
}
