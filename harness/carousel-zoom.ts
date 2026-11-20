// Home's Recommendations carousel at every desktop browser zoom. Chrome's zoom shrinks the CSS viewport and raises
// devicePixelRatio, so each zoom on a common monitor is emulated as a Chromium viewport of screen ÷ zoom with that
// device scale. Prints one row per distinct viewport, flags values outside the range seen at 1440×900 @100% (the
// tuned view), and with --compare writes a before/after page to .reports/.
//
//   bun harness/carousel-zoom.ts                         this working tree's production build, served by the bench
//   bun harness/carousel-zoom.ts --port N                whatever already serves http://localhost:N (`wt serve`)
//   bun harness/carousel-zoom.ts --compare <git-ref>     before (the ref's build) and after, one page with crops
//   bun harness/carousel-zoom.ts --only 1440@100,1920@50 just these cases (screen width @ zoom %)
//   bun harness/carousel-zoom.ts --out <dir>             where the page and crops go (default .reports/<day>-carousel-zoom)
//   bun harness/carousel-zoom.ts --walk 60               also step the row 60 songs right, then 120 left (past the loop's
//                                                        seams and its far side), and name every stop whose layout differs
//
// Read-only: lookup reads come from the bench's fixtures and writes are absorbed (bench/server.ts). Exits 3 when a
// case is flagged.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import type { Page } from 'playwright'

import { buildRef, buildWorkingTree } from './bench/build'
import {
  closeBrowsers,
  mark,
  open,
  PWA_LANDSCAPE,
  PWA_PORTRAIT,
  replayFonts,
  SAFARI_LANDSCAPE,
  SAFARI_NARROW,
  VIEWPORTS,
} from './bench/engines/browser'
import type { View } from './bench/engines/browser'
import { serveBuild } from './bench/server'
import type { BenchServer } from './bench/server'
import { repoAt, storeDir } from './bench/store'
import type { Repo } from './bench/store'

const SCREENS = [
  { height: 900, width: 1440 },
  { height: 768, width: 1366 },
  { height: 1080, width: 1920 },
  { height: 1440, width: 2560 },
]
const ZOOMS = [
  25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500,
]
// Two cases whose CSS viewports are this close on both axes lay out the same; only the first is measured
const SAME_VIEWPORT = 0.05
const PARALLEL = 3

// Flag thresholds, each against the reference case measured in the same run:
// - the centred slide's share of the row below 3/4 of the reference's: a centre a quarter smaller against the row
//   lets the extra slides beside it take the eye, the look reported from low zoom
// - centre:side size off the reference's by more than 2% (the side scale is a CSS proportion; a px-based one drifts)
// - the two centre-to-side gaps unequal by more than 1px
// - gap ÷ slide outside 0.5×-2.5× the reference's: slides that touch, or float apart
// - a neighbour showing less than 16px, too little to read as a peek (the phone views show 23-26px under a 32px
//   fade, which reads fine)
// - any slide beyond the two neighbours showing more than the edge fade: a shelf, not one centred slide
// - the row taller than 80% of the viewport: it can't be seen whole with its heading
// - the row shorter than half the reference's share of the viewport height
// - the centred slide's title block cut off, the arrows overlapping the heading or within 16px of the charts, a box
//   clipping the row without its fade, or the page panning sideways
const SHARE_MIN = 0.75
const RATIO_TOLERANCE = 0.02
const GAP_RANGE = [0.5, 2.5] as const
const TALL_MAX = 0.8
const SHORT_MIN = 0.5
const CROWD_PX = 16
const PEEK_MIN_PX = 16

const { values: flags } = parseArgs({
  options: {
    compare: { type: 'string' },
    only: { type: 'string' },
    out: { type: 'string' },
    port: { type: 'string' },
    walk: { type: 'string' },
  },
})

const log = (m: string): void => {
  process.stderr.write(`· ${m}\n`)
}

interface Case {
  name: string
  screen: { width: number; height: number }
  zoom: number
  viewport: { width: number; height: number }
  /** A phone view (browser.ts), opened as it is instead of at a zoom */
  phone?: View
}

// The phone views, measured the same way so a desktop fix is seen not to move them
const PHONES = [
  PWA_PORTRAIT,
  PWA_LANDSCAPE,
  SAFARI_LANDSCAPE,
  SAFARI_NARROW,
].map((v): Case => {
  const size =
    v.surface.kind === 'phone'
      ? VIEWPORTS[v.surface.narrow === true ? 'narrow' : v.surface.orientation]
      : VIEWPORTS.desktop
  return { name: v.name, phone: v, screen: size, viewport: size, zoom: 100 }
})

const near = (a: number, b: number) => Math.abs(a - b) / b <= SAME_VIEWPORT

const allCases = (): Case[] => {
  const cases: Case[] = []
  const add = (screen: Case['screen'], zoom: number) => {
    const viewport = {
      height: Math.round(screen.height / (zoom / 100)),
      width: Math.round(screen.width / (zoom / 100)),
    }
    const name = `${screen.width}@${zoom}`
    if (
      cases.some(
        (c) =>
          c.name === name ||
          (near(c.viewport.width, viewport.width) &&
            near(c.viewport.height, viewport.height))
      )
    ) {
      return
    }
    cases.push({ name, screen, viewport, zoom })
  }
  // The reference first, so a duplicate of it is the one skipped
  add(SCREENS[0], 100)
  for (const screen of SCREENS) {
    for (const zoom of ZOOMS) {
      add(screen, zoom)
    }
  }
  return [...cases, ...PHONES]
}

const REFERENCE = '1440@100'

interface Measure {
  layout: 'beside' | 'stacked'
  slideW: number
  slideH: number
  share: number
  sideW: number
  ratio: number
  gapL: number
  gapR: number
  fade: number
  peekL: number
  peekR: number
  extra: number
  rowH: number
  rowShare: number
  titleClipped: boolean
  arrows: 'hidden' | 'ok' | 'overlap-heading' | 'overlap-charts'
  arrowsToCharts: number | null
  hardCut: boolean
  pan: number
}

interface Box {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

const SECTION = 'section[aria-label=Recommendations]'
const TRACK = '[data-bench=carousel]'
const SLIDE = `${TRACK} [data-bench=carousel-slide]`

// Every box from getBoundingClientRect, so the off-centre slides' scale is in it
const boxes = async (page: Page, selector: string): Promise<Box[]> =>
  await page.$$eval(selector, (els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return {
        bottom: r.bottom,
        height: r.height,
        left: r.left,
        right: r.right,
        top: r.top,
        width: r.width,
      }
    })
  )

const one = async (page: Page, selector: string): Promise<Box | undefined> => {
  const [first] = await boxes(page, selector)
  return first
}

// What the page holds beyond boxes: the edge fade's length as the row's mask uses it, ancestors that clip the row
// sideways, each title block's overflow, the document's sideways overflow and the viewport's height
const facts = async (page: Page) =>
  await page.$eval(TRACK, (track) => {
    const probe = document.createElement('div')
    probe.style.cssText =
      'position:absolute;visibility:hidden;height:0;width:var(--peek)'
    track.parentElement?.append(probe)
    const fade = probe.getBoundingClientRect().width
    probe.remove()
    const clips: { left: number; right: number }[] = []
    for (
      let el = track.parentElement;
      el !== null && el !== document.body;
      el = el.parentElement
    ) {
      if (getComputedStyle(el).overflowX !== 'visible') {
        const { left, right } = el.getBoundingClientRect()
        clips.push({ left, right })
      }
    }
    const textOverflow = [
      ...track.querySelectorAll('[data-bench=carousel-slide] > :nth-child(2)'),
    ].map((el) => el.scrollHeight - el.clientHeight)
    const doc = document.scrollingElement ?? document.documentElement
    return {
      clips,
      fade,
      pan: Math.max(0, doc.scrollWidth - doc.clientWidth),
      textOverflow,
      viewportH: innerHeight,
    }
  })

const round = (n: number) => Math.round(n * 10) / 10
const ratio = (n: number) => Math.round(n * 1000) / 1000
const centreX = (b: Box) => b.left + b.width / 2
const overlaps = (a: Box, b: Box) =>
  a.left < b.right - 0.5 &&
  b.left < a.right - 0.5 &&
  a.top < b.bottom - 0.5 &&
  b.top < a.bottom - 0.5

// The index of the box whose centre is nearest x
const nearestTo = (all: Box[], x: number): number => {
  let best = 0
  for (const [i, b] of all.entries()) {
    if (Math.abs(centreX(b) - x) < Math.abs(centreX(all[best]) - x)) {
      best = i
    }
  }
  return best
}

const arrowState = (
  buttons: Box[],
  heading: Box | undefined,
  charts: Box | undefined
): Measure['arrows'] => {
  if (charts !== undefined && buttons.some((b) => overlaps(b, charts))) {
    return 'overlap-charts'
  }
  if (heading !== undefined && buttons.some((b) => overlaps(b, heading))) {
    return 'overlap-heading'
  }
  return buttons.length === 0 ? 'hidden' : 'ok'
}

const measurePage = async (page: Page): Promise<Measure> => {
  const tr = await one(page, TRACK)
  const section = await one(page, SECTION)
  if (tr === undefined || section === undefined) {
    throw new Error('no carousel on the page')
  }
  const pics = await boxes(page, `${SLIDE} > :first-child`)
  const texts = await boxes(page, `${SLIDE} > :nth-child(2)`)
  const heading = await one(page, `${SECTION} div:has(> h2)`)
  const arrows = await boxes(
    page,
    `${SECTION} button[aria-label$="Recommendation"]`
  )
  const buttons = arrows.filter((b) => b.width > 0)
  const charts = await one(page, '[data-bench=charts]')
  const f = await facts(page)
  const ci = nearestTo(pics, centreX(tr))
  const [l, c, r] = [pics[ci - 1], pics[ci], pics[ci + 1]]
  const shown = (b: Box) =>
    Math.max(0, Math.min(b.right, tr.right) - Math.max(b.left, tr.left))
  const beside =
    charts !== undefined &&
    charts.top < section.bottom &&
    charts.left >= section.right - 1
  const lastArrow = buttons.at(-1)
  return {
    arrows: arrowState(buttons, heading, charts),
    arrowsToCharts:
      beside && lastArrow !== undefined
        ? round(charts.left - lastArrow.right)
        : null,
    extra: pics.filter((b, i) => Math.abs(i - ci) > 1 && shown(b) > f.fade)
      .length,
    fade: round(f.fade),
    gapL: round(c.left - l.right),
    gapR: round(r.left - c.right),
    hardCut: f.clips.some(
      (b) => b.left > tr.left + 0.5 || b.right < tr.right - 0.5
    ),
    layout: beside ? 'beside' : 'stacked',
    pan: f.pan,
    peekL: round(shown(l)),
    peekR: round(shown(r)),
    ratio: ratio(c.width / l.width),
    rowH: round(tr.height),
    rowShare: ratio(tr.height / f.viewportH),
    share: ratio(c.width / tr.width),
    sideW: round(l.width),
    slideH: round(c.height),
    slideW: round(c.width),
    titleClipped:
      texts[ci].bottom > tr.bottom + 0.5 || (f.textOverflow[ci] ?? 0) > 1,
  }
}

// The carousel (its heading, arrows and row), cut to what the viewport shows. False when none of it shows
const shootBand = async (page: Page, file: string): Promise<boolean> => {
  const b = await one(page, SECTION)
  const viewport = page.viewportSize()
  if (b === undefined || viewport === null) {
    return false
  }
  const top = Math.max(0, b.top - 8)
  const left = Math.max(0, b.left - 8)
  const clip = {
    height: Math.min(viewport.height, b.bottom + 8) - top,
    width: Math.min(viewport.width, b.right + 8) - left,
    x: left,
    y: top,
  }
  if (clip.height <= 0 || clip.width <= 0) {
    log(
      `no crop for ${file}: carousel at ${Math.round(b.top)}-${Math.round(b.bottom)} in a ${viewport.height}px viewport`
    )
    return false
  }
  await page.screenshot({ clip, path: file })
  return true
}

const pct = (n: number) => `${Math.round(n * 100)}%`

interface Row {
  case: Case
  m: Measure | null
  error?: string
  shot?: string
  flags: string[]
}

// The row is a loop of copies: stepping far enough crosses the seam between copies, the jump back to the middle
// copy and the song half a loop away. Every stop must look like the first: same slide and neighbour widths, same
// gaps, the centred slide on the row's centre
const WALK_TOLERANCE = 1
let walkFaults = 0
const walk = async (
  page: Page,
  name: string,
  steps: number,
  first: Measure
) => {
  const songs = new Set<string>()
  const stop = async (label: string) => {
    await page.evaluate(async () => await window.__bench.settle(5000))
    // The neighbours' 150ms scale transition
    await page.waitForTimeout(250)
    songs.add(
      await page.evaluate(
        (slide) =>
          document
            .querySelector(`${slide}[data-active=true]`)
            ?.getAttribute('title') ?? '',
        SLIDE
      )
    )
    const m = await measurePage(page)
    const tr = await one(page, TRACK)
    const pics = await boxes(page, `${SLIDE} > :first-child`)
    const off =
      tr === undefined
        ? 0
        : centreX(pics[nearestTo(pics, centreX(tr))]) - centreX(tr)
    const diffs = (
      [
        ['centre', m.slideW, first.slideW],
        ['side', m.sideW, first.sideW],
        ['gap left', m.gapL, first.gapL],
        ['gap right', m.gapR, first.gapR],
        ['peek left', m.peekL, first.peekL],
        ['peek right', m.peekR, first.peekR],
        ['off centre', round(off), 0],
      ] as const
    ).filter(([, got, want]) => Math.abs(got - want) > WALK_TOLERANCE)
    if (diffs.length > 0) {
      walkFaults += 1
      process.stdout.write(
        `  ! ${name} ${label}: ${diffs.map(([k, got, want]) => `${k} ${got} (first ${want})`).join(', ')}\n`
      )
    }
  }
  await page.focus(TRACK)
  /* oxlint-disable no-await-in-loop -- one step at a time: each stop is measured after the row settles */
  for (let i = 1; i <= steps; i += 1) {
    await page.keyboard.press('ArrowRight')
    await stop(`${i} right`)
  }
  for (let i = 1; i <= steps * 2; i += 1) {
    await page.keyboard.press('ArrowLeft')
    await stop(`${i} left of there`)
  }
  /* oxlint-enable no-await-in-loop */
  log(
    `walked ${name}: ${steps * 3} stops, ${songs.size} different songs centred`
  )
}

const measure = async (
  origin: string,
  c: Case,
  shotDir: string | null,
  side: string
): Promise<Row> => {
  const opened =
    c.phone === undefined
      ? await open(
          { engine: 'chromium', kind: 'desktop' },
          { scale: c.zoom / 100 }
        )
      : await open(c.phone.surface)
  const { page } = opened
  try {
    if (c.phone === undefined) {
      await page.setViewportSize(c.viewport)
    }
    await page.goto(new URL('/', origin).href)
    await mark(page, 'carousel-slide')
    await mark(page, 'charts-row')
    // The band at the top of the screen, held still as a pointer over it holds it (use-auto-advance.ts): it would
    // otherwise move on by itself after 6 s. A synthetic pointerenter works on the touch views too
    await page.evaluate(() => {
      const section = document
        .querySelector('[data-bench=carousel]')
        ?.closest('section')
      section?.parentElement?.scrollIntoView({ block: 'start' })
      // Clear of the fixed top bar, which would cover the heading in the crop
      const bar = document
        .querySelector('[data-topbar]')
        ?.getBoundingClientRect()
      document
        .querySelector('[data-scroll-top]')
        ?.scrollBy({ behavior: 'instant', top: -((bar?.height ?? 0) + 8) })
      section?.dispatchEvent(new PointerEvent('pointerenter'))
    })
    await page.evaluate(async () => await window.__bench.settle(5000))
    const m = await measurePage(page)
    let shot: string | undefined
    const name = `${side}-${c.name.replace('@', '-')}.png`
    if (shotDir !== null && (await shootBand(page, path.join(shotDir, name)))) {
      shot = name
    }
    if (flags.walk !== undefined && side === 'after') {
      await walk(page, c.name, Number(flags.walk), m)
    }
    return { case: c, flags: [], m, shot }
  } catch (error) {
    return {
      case: c,
      error:
        error instanceof Error ? error.message.split('\n')[0] : String(error),
      flags: [],
      m: null,
    }
  } finally {
    await opened.close()
  }
}

// Flags against the reference case
const againstReference = (m: Measure, ref: Measure): string[] => {
  const f: string[] = []
  if (m.share < ref.share * SHARE_MIN) {
    f.push(`centre ${pct(m.share)} of row (ref ${pct(ref.share)})`)
  }
  if (Math.abs(m.ratio / ref.ratio - 1) > RATIO_TOLERANCE) {
    f.push(`centre:side ${m.ratio} (ref ${ref.ratio})`)
  }
  const g = (m.gapL + m.gapR) / 2 / m.slideW
  const g0 = (ref.gapL + ref.gapR) / 2 / ref.slideW
  if (g < g0 * GAP_RANGE[0] || g > g0 * GAP_RANGE[1]) {
    f.push(`gap ${pct(g)} of slide (ref ${pct(g0)})`)
  }
  if (m.rowShare < ref.rowShare * SHORT_MIN) {
    f.push(`row ${pct(m.rowShare)} of screen height (ref ${pct(ref.rowShare)})`)
  }
  return f
}

const judge = (rows: Row[]) => {
  const ref = rows.find((r) => r.case.name === REFERENCE)?.m ?? null
  for (const row of rows) {
    const { m } = row
    if (m === null) {
      row.flags.push(`no measure: ${row.error ?? '?'}`)
      continue
    }
    const f = row.flags
    if (ref !== null) {
      f.push(...againstReference(m, ref))
    }
    if (Math.abs(m.gapL - m.gapR) > 1) {
      f.push(`gaps ${m.gapL}/${m.gapR}`)
    }
    if (Math.min(m.peekL, m.peekR) < PEEK_MIN_PX) {
      f.push(`peek ${Math.min(m.peekL, m.peekR)}px`)
    }
    if (m.extra > 0) {
      f.push(`${m.extra} more slides beyond the neighbours`)
    }
    if (m.rowShare > TALL_MAX) {
      f.push(`row ${pct(m.rowShare)} of screen height`)
    }
    if (m.titleClipped) {
      f.push('title cut off')
    }
    if (m.arrows.startsWith('overlap')) {
      f.push(`arrows ${m.arrows}`)
    }
    if (m.arrowsToCharts !== null && m.arrowsToCharts < CROWD_PX) {
      f.push(`arrows ${m.arrowsToCharts}px from charts`)
    }
    if (m.hardCut) {
      f.push('row clipped without its fade')
    }
    if (m.pan > 0) {
      f.push(`pans ${m.pan}px sideways`)
    }
  }
}

const COLUMNS = [
  'case',
  'css viewport',
  'layout',
  'centre',
  'phys',
  'share',
  'side',
  'c:s',
  'gaps',
  'peek L/R',
  'extra',
  'row/vh',
  'arrows→charts',
]

const cells = (row: Row): string[] => {
  const { m, case: c } = row
  const head = [c.name, `${c.viewport.width}×${c.viewport.height}`]
  if (m === null) {
    return [...head, ...COLUMNS.slice(2).map(() => '-')]
  }
  return [
    ...head,
    m.layout,
    `${m.slideW}×${m.slideH}`,
    String(Math.round((m.slideW * c.zoom) / 100)),
    pct(m.share),
    String(m.sideW),
    String(m.ratio),
    `${m.gapL}/${m.gapR}`,
    `${m.peekL}/${m.peekR}`,
    String(m.extra),
    pct(m.rowShare),
    m.arrowsToCharts === null ? m.arrows : String(m.arrowsToCharts),
  ]
}

const printTable = (title: string, rows: Row[]) => {
  const table = [COLUMNS, ...rows.map(cells)]
  const widths = COLUMNS.map((_, i) =>
    Math.max(...table.map((r) => r[i].length))
  )
  process.stdout.write(`\n${title}\n`)
  for (const [i, r] of table.entries()) {
    const line = r.map((v, j) => v.padEnd(widths[j])).join('  ')
    const flagged = i > 0 ? rows[i - 1].flags : []
    process.stdout.write(
      `${line}${flagged.length > 0 ? `  ! ${flagged.join('; ')}` : ''}\n`
    )
  }
}

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

const runAll = async (
  origin: string,
  cases: Case[],
  shotDir: string | null,
  side: string
): Promise<Row[]> => {
  const rows: Row[] = Array.from({ length: cases.length })
  let next = 0
  const worker = async () => {
    while (next < cases.length) {
      const i = next
      next += 1
      log(`${side} ${cases[i].name}`)
      // oxlint-disable-next-line eslint/no-await-in-loop -- a pool of PARALLEL workers, one page each at a time
      rows[i] = await measure(origin, cases[i], shotDir, side)
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker))
  judge(rows)
  return rows
}

const escape = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const caption = (row: Row) => {
  const { m } = row
  if (m === null) {
    return escape(row.flags.join('; '))
  }
  const base = `centre ${m.slideW}px (${pct(m.share)} of row) · gaps ${m.gapL}/${m.gapR} · peeks ${m.peekL}/${m.peekR} · ${m.extra} extra · row ${pct(m.rowShare)} of height`
  return `${escape(base)}${row.flags.length > 0 ? `<br><span class="bad">${escape(row.flags.join('; '))}</span>` : ''}`
}

const changed = (b: Row, a: Row) =>
  JSON.stringify(cells(b).slice(2)) !== JSON.stringify(cells(a).slice(2)) ||
  b.flags.join('; ') !== a.flags.join('; ')

const page = (before: Row[], after: Row[], title: string) => {
  const pairs = before.map((b, i) => [b, after[i]] as const)
  const shots = pairs
    .filter(
      ([b, a]) => changed(b, a) && b.shot !== undefined && a.shot !== undefined
    )
    .map(
      ([b, a]) => `
  <h2>${escape(b.case.name)}% · ${b.case.screen.width}×${b.case.screen.height} screen, CSS viewport ${b.case.viewport.width}×${b.case.viewport.height}</h2>
  <div class="pair">
    <figure><img src="${b.shot}" alt="Before at ${escape(b.case.name)}"><figcaption><b>Before</b> · ${caption(b)}</figcaption></figure>
    <figure><img src="${a.shot}" alt="After at ${escape(a.case.name)}"><figcaption><b>After</b> · ${caption(a)}</figcaption></figure>
  </div>`
    )
    .join('')
  const head = `<tr><th></th>${COLUMNS.map((c) => `<th>${escape(c)}</th>`).join('')}<th>flags</th></tr>`
  const tr = (row: Row, side: string) =>
    `<tr class="${side}"><td>${side}</td>${cells(row)
      .map((v) => `<td>${escape(v)}</td>`)
      .join('')}<td class="bad">${escape(row.flags.join('; '))}</td></tr>`
  const table = pairs.map(([b, a]) => tr(b, 'before') + tr(a, 'after')).join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carousel Zoom</title>
<style>
  body { margin: 0; padding: 16px; background: #111; color: #ddd; font: 14px/1.45 system-ui, sans-serif; }
  h1 { font-size: 18px; margin: 0 0 8px; } h2 { font-size: 14px; margin: 28px 0 8px; color: #fff; }
  p { max-width: 70ch; color: #aaa; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
  figure { margin: 0; min-width: 0; }
  img { display: block; width: 100%; height: auto; border: 1px solid #333; }
  figcaption { margin-top: 6px; font-size: 12px; color: #bbb; }
  .bad { color: #f88; }
  .wrap { overflow-x: auto; margin-top: 32px; }
  table { border-collapse: collapse; font: 12px/1.3 ui-monospace, monospace; white-space: nowrap; }
  th, td { padding: 3px 8px; border-bottom: 1px solid #262626; text-align: left; }
  tr.after td { border-bottom-color: #444; }
  tr.before td:first-child { color: #888; } tr.after td:first-child { color: #8c8; }
  @media (width < 900px) { .pair { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>${escape(title)}</h1>
<p>Each zoom emulated as screen ÷ zoom CSS px at device scale = zoom. Crops show the carousel in physical pixels, scaled to fit. "phys" is the centre slide's width on the monitor.</p>
${shots}
<div class="wrap"><table>${head}${table}</table></div>
</body>
</html>
`
}

const main = async () => {
  const repo = repoAt(process.cwd())
  replayFonts(storeDir(repo, 'bench', 'fixtures', 'fonts'))
  const only = flags.only?.split(',').map((s) => s.trim())
  const cases = allCases().filter(
    (c) => only === undefined || only.includes(c.name) || c.name === REFERENCE
  )
  let after: string
  if (flags.port === undefined) {
    after = serve(repo, await buildWorkingTree(repo, log))
  } else {
    if (!/^\d+$/u.test(flags.port)) {
      throw new Error(`--port must be a number, not "${flags.port}"`)
    }
    after = `http://localhost:${flags.port}`
  }
  const day = new Date().toLocaleDateString('en-CA')
  const dir =
    flags.out ?? path.join(repo.top, '.reports', `${day}-carousel-zoom`)
  const { compare } = flags
  if (compare === undefined) {
    const rows = await runAll(after, cases, null, 'after')
    printTable('carousel at each zoom', rows)
    process.exitCode =
      rows.some((r) => r.flags.length > 0) || walkFaults > 0 ? 3 : 0
    return
  }
  const sha = execFileSync('git', ['-C', repo.top, 'rev-parse', compare], {
    encoding: 'utf-8',
  }).trim()
  const { dist } = await buildRef(repo, sha, log)
  const before = serve(repo, dist)
  mkdirSync(dir, { recursive: true })
  const b = await runAll(before, cases, dir, 'before')
  const a = await runAll(after, cases, dir, 'after')
  printTable(`before (${compare})`, b)
  printTable('after', a)
  writeFileSync(
    path.join(dir, 'rows.json'),
    JSON.stringify({ after: a, before: b }, null, 2)
  )
  const index = path.join(dir, 'index.html')
  writeFileSync(
    index,
    page(
      b,
      a,
      `Recommendations carousel at every zoom: ${compare} → working tree`
    )
  )
  process.stdout.write(`\n${index}\n`)
  process.exitCode = a.some((r) => r.flags.length > 0) ? 3 : 0
}

try {
  await main()
} catch (error) {
  process.stderr.write(
    `carousel-zoom: ${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exitCode = 1
} finally {
  for (const s of servers) {
    s.stop()
  }
  await closeBrowsers()
}
