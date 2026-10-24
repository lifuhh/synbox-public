// The main user flows against a real deployed copy of the app (a deploy preview of staging, or https://synbox.io),
// with the real backends behind it: the check that "everything still works as normal", which `check` can't make on
// recorded data. Read-only by construction: every write the app would send to Synbox's own services (the auth
// Worker behind /api, api.synbox.io, Appwrite, the lookup and generation services, Sentry) is answered here at the
// network layer, and one that isn't on the list below is blocked and fails the run.
//
//   bun harness/smoke.ts <url> [--song <id>]   e.g. https://deploy-preview-335--synbox.netlify.app or https://synbox.io
//
// One line per flow, `smoke PASS|FAIL`, exit 0 or 1, and a report in the main checkout's
// .reports/YYYY-MM-DD-smoke-<host>/ (index.html, result.json, a screenshot of each failed flow). About 40 seconds
// (2026-10-24): the three views run side by side. The songs are picked from the live data at run time; `--song`
// names the library song instead. What each flow checks: harness/README.md › "On a deployed copy".

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import type { BrowserContext, Page, Route } from 'playwright'

import { SECURITY_HEADERS } from '../netlify/security-headers'
import {
  ALL_VIEWS,
  closeBrowsers,
  mark,
  open,
  replayFonts,
} from './bench/engines/browser'
import type { View } from './bench/engines/browser'
import { isRecord } from './bench/json'
import { repoAt, storeDir } from './bench/store'

// The YouTube Top 100 Songs Japan chart, the one the home page and chart songs read (src/lib/youtube/api.ts)
const CHART = 'PL4fGSI1pDJn4-UIb6RKHdxam-oAUULIGB'
// Public videos that are not songs, for "Not on Synbox": the first that is in neither the chart nor the library
const NOT_SONGS = ['jNQXAC9IVRw', 'aqz-KE-bpKQ']
const FLOW_LIMIT_MS = 90_000
// Words in titles that name no song: a search for them proves nothing about the song picked
const NOISE = new Set(
  [
    'the',
    'first',
    'take',
    'feat',
    'ft',
    'official',
    'music',
    'video',
    'mv',
    'covered',
    'cover',
    'by',
    'ver',
    'version',
    'lyrics',
    'live',
    'audio',
    'produced',
    'prod',
    'channel',
  ].map((w) => w.toLowerCase())
)

// ---- What one run holds ----

type FlowName =
  | 'home'
  | 'library-song'
  | 'search'
  | 'chart-song'
  | 'not-a-song'
  | 'reader-versions'
  | 'sign-in'

interface Picks {
  library: { id: string; title: string; count: number } | string
  query: string | null
  chart: { id: string; title: string } | string
  notSong: string | null
  libraryIds: Set<string>
}

/** A write the app sent to one of Synbox's own services, and what this script did with it */
interface Write {
  view: string
  flow: string
  method: string
  url: string
  rule: string
  /** false: not on the list, blocked, and the run fails */
  expected: boolean
  body: string
}

interface CspViolation {
  view: string
  flow: string
  what: string
}

interface FlowResult {
  flow: FlowName | 'security-headers'
  view: string
  pass: boolean
  evidence: string
  ms: number
  screenshot?: string
  /** Failed because this machine lost its connection, not because of the app: run once more */
  network?: boolean
  /** Why it was run a second time */
  retried?: string
}

// This machine's connection dropping (Chromium, then WebKit wording), seen mid-run on 2026-10-24: says nothing about
// the site
const NETWORK_DOWN =
  /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED|Internet connection appears to be offline|network connection was lost/u

/** Thrown by a flow with the measurement that failed it */
class FailedError extends Error {
  override name = 'FailedError'
}
const fail = (message: string): never => {
  throw new FailedError(message)
}

// ---- The live data the flows run on ----

const getJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) {
    throw new Error(`GET ${url} answered ${response.status}`)
  }
  return await response.json()
}

const strings = (v: unknown, key: string): string | null =>
  isRecord(v) && typeof v[key] === 'string' ? v[key] : null

/** The chart's video ids, both pages, as the app reads them */
const chartIds = async (
  origin: string
): Promise<{ id: string; title: string }[]> => {
  const songs: { id: string; title: string }[] = []
  let token: string | null = null
  for (let page = 0; page < 2; page += 1) {
    const query = token === null ? '' : `?pageToken=${token}`
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page needs the previous page's token
    const body = await getJson(
      `${origin}/api/youtube/playlist/${CHART}${query}`
    )
    const items = isRecord(body) && Array.isArray(body.items) ? body.items : []
    for (const item of items) {
      const snippet = isRecord(item) ? item.snippet : null
      const id = isRecord(snippet)
        ? strings(snippet.resourceId, 'videoId')
        : null
      if (id !== null) {
        songs.push({ id, title: strings(snippet, 'title') ?? '' })
      }
    }
    token = strings(body, 'nextPageToken')
    if (token === null) {
      break
    }
  }
  return songs
}

const japanese = (w: string) =>
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(w) ? 1 : 0

/** The longest word of a title that names the song rather than the channel or the format; a Japanese one first */
export const searchWord = (title: string): string | null =>
  title
    // 【...】 holds a tag (a cover's singer, "MV"), not the song
    .replaceAll(/【[^】]*】/gu, ' ')
    .split(/[\s/\-|【】「」『』()（）[\]~～・,:：!！?？"'&＆×]+/u)
    .filter((w) => w.length >= 2 && !NOISE.has(w.toLowerCase()))
    .toSorted((a, b) => japanese(b) - japanese(a) || b.length - a.length)[0] ??
  null

const pick = async (origin: string, song?: string): Promise<Picks> => {
  const body = await getJson(`${origin}/api/library/songs`)
  const songs: unknown[] =
    isRecord(body) && Array.isArray(body.songs) ? body.songs : []
  const libraryIds = new Set(
    songs.flatMap((s) => {
      const id = strings(s, 'video_id')
      return id === null ? [] : [id]
    })
  )
  const karaoke = songs.find((s) =>
    song === undefined
      ? isRecord(s) && s.karaoke === true
      : strings(s, 'video_id') === song
  )
  const missing =
    song === undefined
      ? `no song with karaoke: true among the ${songs.length} in /api/library/songs`
      : `${song} is not in /api/library/songs`
  const library =
    karaoke === undefined
      ? missing
      : {
          count: songs.length,
          id: strings(karaoke, 'video_id') ?? '',
          title: strings(karaoke, 'title') ?? '',
        }
  const chart = await chartIds(origin).catch((error: unknown) =>
    error instanceof Error ? error.message : String(error)
  )
  const outside =
    typeof chart === 'string'
      ? `the chart could not be read: ${chart}`
      : (chart.find((s) => !libraryIds.has(s.id)) ??
        `all ${chart.length} chart songs are in the library`)
  const charted = new Set(
    typeof chart === 'string' ? [] : chart.map((s) => s.id)
  )
  let notSong: string | null = null
  for (const id of NOT_SONGS) {
    if (!libraryIds.has(id) && !charted.has(id)) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the first public one is enough
      const video = await getJson(`${origin}/api/youtube/video/${id}`).catch(
        () => null
      )
      if (
        isRecord(video) &&
        Array.isArray(video.items) &&
        video.items.length > 0
      ) {
        notSong = id
        break
      }
    }
  }
  return {
    chart: outside,
    library,
    libraryIds,
    notSong,
    query: typeof library === 'string' ? null : searchWord(library.title),
  }
}

// ---- The network guard ----

/** Synbox's own services; a write anywhere else (YouTube's player logging its own playback) is not ours */
const isOurs = (url: URL, origin: string) =>
  url.origin === origin ||
  /(?:^|\.)synbox\.io$/u.test(url.hostname) ||
  /(?:^|\.)appwrite\.io$/u.test(url.hostname) ||
  /(?:^|\.)sentry\.io$/u.test(url.hostname) ||
  /^synbox-[\w-]+\.(?:[\w-]+\.)?run\.app$/u.test(url.hostname)

/** One of the generation calls: through the auth Worker (worker/src/generation.ts), or straight to the Cloud Run
 * service from a build older than that */
const isGeneration = (url: URL, endpoint: string) =>
  (url.hostname === 'api.synbox.io' &&
    url.pathname === `/api/generation/${endpoint}`) ||
  (url.hostname.endsWith('.run.app') && url.pathname === `/${endpoint}`)

const cors = (origin: string) => ({
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'authorization, content-type, accept',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-origin': origin,
})

const STOPPED = 'Smoke test: stopped before the paid pipeline'
const GOOGLE_STUB =
  'https://accounts.google.com/o/oauth2/v2/auth?client_id=smoke-test&state=smoke-test'

interface WriteRule {
  name: string
  matches: (url: URL, origin: string) => boolean
  answer: (route: Route, origin: string) => Promise<void>
}

/**
 * The writes a guest's visit sends, each answered here so none reaches a service. Anything else that writes to
 * Synbox's services is blocked and fails the run: add it here only with what it would have changed.
 */
const WRITE_RULES: WriteRule[] = [
  {
    // A visit to a library song's page counts one listen (src/lib/song-stats.ts › countListen)
    answer: async (route) => {
      await route.fulfill({ json: { ok: true } })
    },
    matches: (url, origin) =>
      url.origin === origin &&
      /^\/api\/songs\/[\w-]{11}\/listen$/u.test(url.pathname),
    name: 'listen',
  },
  {
    // Sentry's error and replay ingest: an event from a smoke run is noise in the real project. Answered rather than
    // aborted: WebKit reports an aborted ingest fetch as an uncaught error
    answer: async (route) => {
      await route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        json: {},
      })
    },
    matches: (url) => /(?:^|\.)sentry\.io$/u.test(url.hostname),
    name: 'sentry',
  },
  {
    // Whether the backend takes the song: answered "yes", so the app goes on to the next step
    answer: async (route, origin) => {
      await route.fulfill({ headers: cors(origin), json: { ok: true } })
    },
    matches: (url) => isGeneration(url, 'generation-check'),
    name: 'generation-check',
  },
  {
    // The paid step: /validate downloads the song and runs the whole pipeline. Answered with an error line, the
    // shape the backend uses to refuse, so the app shows a failed generation and spends nothing
    answer: async (route, origin) => {
      await route.fulfill({
        body: `${JSON.stringify({ code: 'smoke_test', data: STOPPED, type: 'error' })}\n`,
        headers: { ...cors(origin), 'content-type': 'application/x-ndjson' },
      })
    },
    matches: (url) => isGeneration(url, 'validate'),
    name: 'generation-validate',
  },
  {
    // Sign-in with Google: the auth Worker would store a state row and answer Google's address; answered here
    // with an address of the same shape, which the app then opens
    answer: async (route) => {
      await route.fulfill({ json: { redirect: true, url: GOOGLE_STUB } })
    },
    matches: (url, origin) =>
      url.origin === origin && url.pathname === '/api/auth/sign-in/social',
    name: 'sign-in',
  },
]

interface Guard {
  writes: Write[]
  csp: CspViolation[]
  flow: string
}

/** Answers every write and records it; reads go out untouched. Registered after `open`'s routes, so it runs first */
const guard = async (
  context: BrowserContext,
  origin: string,
  view: string,
  log: Guard
): Promise<void> => {
  await context.route('**/*', async (route) => {
    const request = route.request()
    const method = request.method()
    const url = new URL(request.url())
    if (method === 'GET' || method === 'HEAD') {
      // A deploy preview's Netlify Drawer is Netlify's, not the app's; the site's CSP blocks its frame anyway
      if (
        url.origin === origin &&
        url.pathname.startsWith('/.netlify/scripts/')
      ) {
        await route.abort('blockedbyclient')
        return
      }
      // Google's sign-in page itself is never loaded: reaching its address is the pass
      if (url.hostname === 'accounts.google.com') {
        await route.fulfill({
          body: '<title>Google (smoke stub)</title>',
          contentType: 'text/html',
        })
        return
      }
      await route.fallback()
      return
    }
    if (!isOurs(url, origin)) {
      await route.fallback()
      return
    }
    const rule = WRITE_RULES.find((r) => r.matches(url, origin))
    if (method === 'OPTIONS') {
      // A preflight for a stubbed route is answered too, so the backend never sees the attempt
      if (rule !== undefined && url.origin !== origin) {
        await route.fulfill({ headers: cors(origin), status: 204 })
        return
      }
      await route.fallback()
      return
    }
    log.writes.push({
      // Sentry's envelopes carry nothing a check reads
      body:
        rule?.name === 'sentry' ? '' : (request.postData() ?? '').slice(0, 300),
      expected: rule !== undefined,
      flow: log.flow,
      method,
      rule: rule?.name ?? 'BLOCKED',
      url: `${url.origin}${url.pathname}`,
      view,
    })
    await (rule === undefined
      ? route.abort('blockedbyclient')
      : rule.answer(route, origin))
  })
}

// ---- The flows ----

interface FlowContext {
  page: Page
  origin: string
  view: View
  picks: Picks
  log: Guard
  /** console.error lines and uncaught errors from the app's own scripts, this flow */
  appErrors: string[]
}

const writesOf = (ctx: FlowContext, rule?: string) =>
  ctx.log.writes.filter(
    (w) =>
      w.view === ctx.view.name &&
      w.flow === ctx.log.flow &&
      (rule === undefined || w.rule === rule)
  )

const need = <T>(value: T | string, what: string): T =>
  typeof value === 'string' ? fail(`precondition: ${what}: ${value}`) : value

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`

const home = async (ctx: FlowContext): Promise<string> => {
  const { page, origin } = ctx
  const library = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/library/songs' &&
      r.request().method() === 'GET',
    { timeout: 30_000 }
  )
  await page.goto(`${origin}/`, { waitUntil: 'commit' })
  const listed = await library.catch(() =>
    fail('no /api/library/songs request')
  )
  const body: unknown = await listed.json().catch(() => null)
  const songs =
    isRecord(body) && Array.isArray(body.songs) ? body.songs.length : 0
  if (!listed.ok() || songs === 0) {
    fail(`/api/library/songs answered ${listed.status()} with ${songs} songs`)
  }
  await mark(page, 'hero-input')
  await mark(page, 'carousel-slide')
  await mark(page, 'charts-done')
  const recs = await page.locator('[data-bench=carousel-slide]').count()
  const charts = await page
    .locator('[data-bench=charts-row]')
    .evaluateAll((rows) => ({
      rows: rows.length,
      withViews: rows.filter((r) =>
        /\d\s*(?:[KMB])?\s+views\b/u.test(r.textContent ?? '')
      ).length,
    }))
  if (charts.withViews < charts.rows * 0.9) {
    fail(`only ${charts.withViews} of ${charts.rows} chart rows show views`)
  }
  await page.evaluate(() =>
    document.querySelector('#gallery-title')?.scrollIntoView({ block: 'start' })
  )
  await mark(page, 'gallery-tile')
  const tiles = await page
    .locator('[data-bench=gallery-tile]')
    .evaluateAll((links) =>
      links.map(
        (a) =>
          /\/v\/(?<id>[\w-]{11})/u.exec(a.getAttribute('href') ?? '')?.groups
            ?.id ?? ''
      )
    )
  const strangers = tiles.filter((id) => !ctx.picks.libraryIds.has(id))
  if (tiles.length === 0 || strangers.length > 0) {
    fail(
      `${tiles.length} gallery cards, ${strangers.length} not in /api/library/songs (${strangers.slice(0, 3).join(', ')})`
    )
  }
  if (ctx.appErrors.length > 0) {
    fail(`${ctx.appErrors.length} app errors: ${ctx.appErrors[0]}`)
  }
  return `hero, ${recs} recommendations, ${charts.rows} chart rows (${charts.withViews} with views), ${tiles.length} gallery cards of ${songs} library songs, 0 app errors`
}

/** Sung parts whose fill moved forward since the last call (each part's --p, written by the player's clock) */
const fillAdvance = async (page: Page) =>
  await page.evaluate(() => {
    window.__smokeFill ??= new WeakMap()
    const seen = window.__smokeFill
    let advanced = 0
    let parts = 0
    for (const el of document.querySelectorAll<HTMLElement>(
      '[style*="--p:"]'
    )) {
      const value = el.style.getPropertyValue('--p')
      const p = value === '' ? Number.NaN : Number(value)
      if (!Number.isNaN(p)) {
        parts += 1
        const before = seen.get(el)
        if (before !== undefined && p > before) {
          advanced += 1
        }
        seen.set(el, p)
      }
    }
    return { advanced, parts }
  })

const phase = async (page: Page) =>
  await page.evaluate(
    () =>
      document.querySelector<HTMLElement>('[data-player-stage]')?.dataset
        .phase ?? 'none'
  )

const librarySong = async (ctx: FlowContext): Promise<string> => {
  const { page, origin } = ctx
  const song = need(ctx.picks.library, 'a library song with karaoke')
  const karaoke = page.waitForResponse(
    (r) => new RegExp(`/karaoke/${song.id}(?:\\?|$)`, 'u').test(r.url()),
    { timeout: 30_000 }
  )
  await page.goto(`${origin}/v/${song.id}`, { waitUntil: 'commit' })
  await mark(page, 'player-iframe', 30_000)
  const readyMs = await mark(page, 'phase-ready', 30_000)
  const timing = await karaoke.catch(() =>
    fail('no karaoke timing request to the lookup service')
  )
  if (timing.status() !== 200) {
    fail(
      `karaoke timing answered ${timing.status()} (${new URL(timing.url()).host})`
    )
  }
  await mark(page, 'phase-playing', 30_000).catch(async () =>
    fail(`playback never started (player phase: ${await phase(page)})`)
  )
  // A line is sung once the clock has written a fill (--p) on one of its parts. Through an intro, the player's own
  // shortcut skips 5 s a press: up to a minute in
  const sung = async () =>
    await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>('[style*="--p:"]')].filter(
          (el) => el.style.getPropertyValue('--p') !== ''
        ).length
    )
  let skips = 0
  // oxlint-disable-next-line eslint/no-await-in-loop -- one look, then one press
  while (skips < 12 && (await sung()) === 0) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one press, then a look
    await page.keyboard.press('ArrowRight')
    skips += 1
    // oxlint-disable-next-line eslint/no-await-in-loop -- one press, then a look
    await page.waitForTimeout(800)
  }
  const lines = await page
    .locator('[data-bench=lyrics-line], [data-bench=lyrics-text]')
    .count()
  if (lines === 0) {
    fail(`no lyrics lines rendered (${skips} skips of 5 s)`)
  }
  // The fill must move between two looks a second apart; an instrumental gap gets up to 20 s to end
  await fillAdvance(page)
  let fill = { advanced: 0, parts: 0 }
  const deadline = Date.now() + 20_000
  while (fill.advanced === 0 && Date.now() < deadline) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- two looks a second apart
    await page.waitForTimeout(1000)
    // oxlint-disable-next-line eslint/no-await-in-loop -- two looks a second apart
    fill = await fillAdvance(page)
  }
  if (fill.advanced === 0) {
    fail(
      `the karaoke fill never advanced (${fill.parts} timed parts, player phase ${await phase(page)})`
    )
  }
  // The listen is sent as the page opens; another second for a duplicate to show
  await page.waitForTimeout(1000)
  const listens = writesOf(ctx, 'listen').length
  if (listens !== 1) {
    fail(`${listens} listen POSTs, expected exactly 1`)
  }
  return `${song.id}: iframe ready at ${seconds(readyMs)}, ${lines} lyrics lines${skips > 0 ? ` (intro skipped ${skips * 5} s)` : ''}, karaoke timing 200 from ${new URL(timing.url()).host}, fill advanced on ${fill.advanced} parts between looks 1 s apart, 1 listen POST (stubbed)`
}

const search = async (ctx: FlowContext): Promise<string> => {
  const { page, origin } = ctx
  const song = need(ctx.picks.library, 'a library song with karaoke')
  const query =
    ctx.picks.query ??
    fail(`precondition: no search word in the title of ${song.id}`)
  await page.goto(`${origin}/search?q=${encodeURIComponent(query)}`, {
    waitUntil: 'commit',
  })
  await mark(page, 'search-result', 30_000)
  // Results arrive from two searches and badges from the library list: read once the set holds for 1.5 s
  const read = async () =>
    await page.locator('[data-bench=search-result]').evaluateAll((cards) =>
      cards.map((card) => ({
        badge: card.querySelector('[data-karaoke-picture-badge]') !== null,
        id:
          /\/v\/(?<id>[\w-]{11})/u.exec(card.getAttribute('href') ?? '')?.groups
            ?.id ??
          /\/vi\/(?<id>[\w-]{11})\//u.exec(
            card.querySelector('img')?.getAttribute('src') ?? ''
          )?.groups?.id ??
          '',
      }))
    )
  let results = await read()
  for (let i = 0; i < 20; i += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- compare two reads 1.5 s apart
    await page.waitForTimeout(1500)
    // oxlint-disable-next-line eslint/no-await-in-loop -- compare two reads 1.5 s apart
    const again = await read()
    if (JSON.stringify(again) === JSON.stringify(results)) {
      break
    }
    results = again
  }
  const plain = results.filter((r) => !r.badge)
  if (!results.some((r) => r.id === song.id)) {
    fail(`"${query}": ${results.length} results, ${song.id} not among them`)
  }
  if (plain.length > 0) {
    fail(
      `"${query}": ${plain.length} of ${results.length} results without the karaoke mic (${plain[0].id})`
    )
  }
  return `"${query}": ${results.length} results, all with the karaoke mic, ${song.id} at #${results.findIndex((r) => r.id === song.id) + 1}`
}

const chartSong = async (ctx: FlowContext): Promise<string> => {
  const { page, origin } = ctx
  const song = need(ctx.picks.chart, 'a chart song outside the library')
  await page.goto(`${origin}/v/${song.id}`, { waitUntil: 'commit' })
  await mark(page, 'player-iframe', 30_000)
  const readyMs = await mark(page, 'phase-ready', 30_000)
  const watch = await page.evaluate(
    () => document.documentElement.dataset.watch !== undefined
  )
  const button = page.getByRole('button', { name: 'Generate Lyrics' })
  // The watch page offers it under "No Lyrics Yet"; the stage's rail shows with the controls, which a pointer brings
  await (watch
    ? page
        .getByText('No Lyrics Yet', { exact: true })
        .waitFor({ timeout: 15_000 })
        .catch(() => fail('"No Lyrics Yet" not shown'))
    : page
        .locator('[data-player-stage]')
        .hover({ force: true, position: { x: 40, y: 40 } })
        .catch(() => null))
  await button
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => fail('no visible Generate Lyrics button'))
  await button.first().click()
  const deadline = Date.now() + 25_000
  while (
    writesOf(ctx, 'generation-validate').length === 0 &&
    Date.now() < deadline
  ) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- polls the recorded writes
    await page.waitForTimeout(250)
  }
  const [check] = writesOf(ctx, 'generation-check')
  const [validate] = writesOf(ctx, 'generation-validate')
  if (check === undefined) {
    fail('pressing Generate Lyrics sent no /generation-check')
  }
  if (
    !check.body.includes(`"id":"${song.id}"`) ||
    !check.body.includes('"kind":"new"')
  ) {
    fail(`/generation-check body: ${check.body}`)
  }
  if (validate === undefined) {
    fail('the generation never reached /validate after the check said yes')
  }
  if (!validate.body.includes(`"id":"${song.id}"`)) {
    fail(`/validate body: ${validate.body}`)
  }
  await page
    .getByText(STOPPED)
    .first()
    .waitFor({ timeout: 10_000 })
    .catch(() => fail('the stubbed stop never showed in the app'))
  const listens = writesOf(ctx, 'listen').length
  if (listens > 0) {
    fail(`${listens} listen POSTs for a song outside the library`)
  }
  return `${song.id}: plays (ready at ${seconds(readyMs)}), ${watch ? '"No Lyrics Yet" + ' : ''}Generate Lyrics → /generation-check {kind: new} (stubbed yes) → /validate (stubbed stop, shown), 0 listens`
}

const notASong = async (ctx: FlowContext): Promise<string> => {
  const { page, origin } = ctx
  const id =
    ctx.picks.notSong ??
    fail(
      `precondition: none of ${NOT_SONGS.join(', ')} is public and outside the chart and library`
    )
  await page.goto(`${origin}/v/${id}`, { waitUntil: 'commit' })
  const heading = page.getByRole('heading', { level: 1 })
  await heading
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(() => fail('no heading'))
  // Long enough for a player that would load anyway to put its iframe in
  await page.waitForTimeout(3000)
  const shown = await heading.first().textContent()
  const text = shown?.trim() ?? ''
  const iframes = await page.locator('iframe[src*="youtube"]').count()
  // Sentry's session pings are telemetry, answered here like the rest; anything else is a write this page must not make
  const writes = writesOf(ctx).filter((w) => w.rule !== 'sentry').length
  if (text !== 'Not on Synbox') {
    fail(`heading "${text}"`)
  }
  if (iframes > 0 || writes > 0) {
    fail(`${iframes} YouTube iframes, ${writes} writes`)
  }
  return `${id}: "Not on Synbox", 0 iframes, 0 writes`
}

const readerVersions = async (ctx: FlowContext): Promise<string> => {
  const { page, origin } = ctx
  const song = need(ctx.picks.library, 'a library song with karaoke')
  // The reader times the song's karaoke from the lookup service, the host the versions list is asked of below
  const timing = page.waitForResponse(
    (r) => /\.run\.app\/karaoke\//u.test(r.url()),
    { timeout: 30_000 }
  )
  await page.goto(`${origin}/lyrics/${song.id}`, { waitUntil: 'commit' })
  await mark(page, 'lyrics-line', 30_000)
  const lines = await page.locator('[data-bench=lyrics-text]').count()
  if (lines < 5) {
    fail(`the reader shows ${lines} lines`)
  }
  const lookup = await timing.catch(() =>
    fail('the reader never asked the lookup service for karaoke timing')
  )
  // Versions are an admin tool: a guest gets the 403 page, and the lookup service refuses the list
  await page.goto(`${origin}/v/${song.id}/versions`, { waitUntil: 'commit' })
  await page
    .getByRole('heading', { name: 'Access Forbidden' })
    .waitFor({ timeout: 20_000 })
    .catch(() => fail('versions: no "Access Forbidden" for a guest'))
  const host = new URL(lookup.url()).origin
  const answer = await fetch(`${host}/lyrics/${song.id}/versions`).catch(
    () => null
  )
  const refused = String(answer?.status ?? 'unreachable')
  if (refused !== '401' && refused !== '403') {
    fail(`the lookup service answered a guest's versions list with ${refused}`)
  }
  return `${song.id}: reader ${lines} lines; versions as a guest: 403 page, lookup service's list ${refused}`
}

const signIn = async (ctx: FlowContext): Promise<string> => {
  const { page, origin } = ctx
  const me = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/me',
    { timeout: 30_000 }
  )
  await page.goto(`${origin}/privacy`, { waitUntil: 'commit' })
  const meResponse = await me.catch(() => fail('no /api/me request'))
  const meBody: unknown = await meResponse.json().catch(() => null)
  if (!meResponse.ok() || !isRecord(meBody) || meBody.user !== null) {
    fail(
      `/api/me answered ${meResponse.status()} ${JSON.stringify(meBody).slice(0, 80)}`
    )
  }
  const button = page.getByRole('button', { name: 'Sign In' }).first()
  await button
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => fail('no visible Sign In button'))
  await button.click()
  await page
    .waitForURL(/^https:\/\/accounts\.google\.com\//u, { timeout: 15_000 })
    .catch(() => fail(`Sign In did not go to Google (at ${page.url()})`))
  const [sent] = writesOf(ctx, 'sign-in')
  if (sent === undefined || !sent.body.includes('"provider":"google"')) {
    fail(`sign-in request body: ${sent?.body ?? 'none'}`)
  }
  return '/api/me 200 (guest), Sign In → POST /api/auth/sign-in/social {provider: google} (stubbed) → accounts.google.com'
}

const FLOWS: { name: FlowName; run: (ctx: FlowContext) => Promise<string> }[] =
  [
    { name: 'home', run: home },
    { name: 'library-song', run: librarySong },
    { name: 'search', run: search },
    { name: 'chart-song', run: chartSong },
    { name: 'not-a-song', run: notASong },
    { name: 'reader-versions', run: readerVersions },
    { name: 'sign-in', run: signIn },
  ]

// ---- Running them ----

const withLimit = async <T>(
  work: Promise<T>,
  ms: number,
  what: string
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      // oxlint-disable-next-line promise/avoid-new -- a time limit as a promise
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new FailedError(`${what} still running after ${seconds(ms)}`))
        }, ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

const runFlow = async (
  flow: (typeof FLOWS)[number],
  view: View,
  origin: string,
  picks: Picks,
  log: Guard,
  shots: string,
  retry = false
): Promise<FlowResult> => {
  const started = Date.now()
  // A retry's writes and violations are its own: the first attempt's must not count toward its listen total
  const label = retry ? `${flow.name} (retry)` : flow.name
  const { context, page, close } = await open(view.surface, {
    serviceWorkers: 'block',
  })
  const flowLog: Guard = { csp: log.csp, flow: label, writes: log.writes }
  await guard(context, origin, view.name, flowLog)
  // Every frame reports its policy violations; only the app's own documents count
  await context.exposeBinding('__smokeCsp', (source, what: string) => {
    if (source.frame.url().startsWith(origin)) {
      log.csp.push({ flow: label, view: view.name, what })
    }
  })
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      void window.__smokeCsp(
        `${e.effectiveDirective} blocked ${e.blockedURI || 'inline'} (${e.sourceFile}:${e.lineNumber})`
      )
    })
  })
  const appErrors: string[] = []
  // A reload in the middle of a flow (the app recovering from a crash) runs every page effect again
  let loads = 0
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && frame.url().startsWith(origin)) {
      loads += 1
    }
  })
  page.on('pageerror', (error) => {
    // Not the app's: WebKit reports Sentry's ingest fetch, which the guard answers, as failing its access checks, and
    // the YouTube player's own script trying to reach into its frame
    if (
      !error.message.startsWith('ResizeObserver loop') &&
      !/sentry\.io|youtube(?:-nocookie)?\.com/u.test(error.message)
    ) {
      appErrors.push(`uncaught: ${error.message.split('\n')[0]}`)
    }
  })
  page.on('console', (message) => {
    const [text] = message.text().split('\n')
    const from = message.location().url
    if (
      /Content Security Policy/u.test(text) &&
      (from === '' || from.startsWith(origin))
    ) {
      log.csp.push({ flow: label, view: view.name, what: `console: ${text}` })
    }
    if (
      message.type() === 'error' &&
      from.startsWith(origin) &&
      !text.startsWith('Failed to load resource:')
    ) {
      appErrors.push(`${text} (${from})`)
    }
  })
  try {
    const evidence = await withLimit(
      flow.run({ appErrors, log: flowLog, origin, page, picks, view }),
      FLOW_LIMIT_MS,
      flow.name
    )
    const thrown = appErrors.filter((e) => e.startsWith('uncaught'))
    if (thrown.length > 0) {
      fail(`${thrown.length} uncaught errors: ${thrown[0]}`)
    }
    return {
      evidence,
      flow: flow.name,
      ms: Date.now() - started,
      pass: true,
      view: view.name,
    }
  } catch (error) {
    const screenshot = path.join(shots, `${flow.name}-${view.name}.jpg`)
    const shot = await page
      .screenshot({
        path: screenshot,
        quality: 50,
        scale: 'css',
        timeout: 5000,
        type: 'jpeg',
      })
      .then(() => path.basename(screenshot))
      .catch(() => null)
    const message =
      error instanceof FailedError
        ? error.message
        : `error: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
    const seen = [
      ...(loads > 1 ? [`${loads} page loads`] : []),
      ...appErrors.slice(0, 2).map((e) => `app error: ${e}`),
    ]
    return {
      evidence: [message, ...seen].join('; '),
      flow: flow.name,
      ms: Date.now() - started,
      network: NETWORK_DOWN.test(message),
      pass: false,
      screenshot: shot ?? undefined,
      view: view.name,
    }
  } finally {
    await close()
  }
}

/**
 * Exact, except HSTS, whose directives must all be there: Netlify sends its own on *.netlify.app (a deploy preview),
 * which adds `preload`
 */
const headerHolds = (name: string, want: string, got: string | null) => {
  if (got === null || name !== 'Strict-Transport-Security') {
    return got === want
  }
  const directives = new Set(got.split(';').map((d) => d.trim()))
  return want.split(';').every((d) => directives.has(d.trim()))
}

const securityHeaders = async (
  origin: string,
  picks: Picks
): Promise<FlowResult> => {
  const started = Date.now()
  const paths = [
    '/',
    typeof picks.library === 'string' ? null : `/v/${picks.library.id}`,
  ].filter((p) => p !== null)
  const missing: string[] = []
  for (const p of paths) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- two pages, one after the other
    const response = await fetch(`${origin}${p}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    })
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      const got = response.headers.get(name)
      if (!headerHolds(name, value, got)) {
        missing.push(`${p} ${name}: ${got === null ? 'missing' : 'differs'}`)
      }
    }
  }
  const pass = missing.length === 0 && paths.length === 2
  let evidence = `${Object.keys(SECURITY_HEADERS).length} headers as netlify/security-headers.ts sets them on ${paths.join(' and ')}`
  if (missing.length > 0) {
    evidence = missing.join('; ')
  } else if (paths.length < 2) {
    evidence = 'precondition: no library song for /v/<id>'
  }
  return {
    evidence,
    flow: 'security-headers',
    ms: Date.now() - started,
    pass,
    view: 'http',
  }
}

const describe = (v: { id: string } | string) =>
  typeof v === 'string' ? `none (${v})` : v.id

const esc = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')

const html = (
  title: string,
  rows: FlowResult[],
  writes: Write[],
  csp: CspViolation[]
) => {
  const row = (r: FlowResult) =>
    `<tr class="${r.pass ? 'ok' : 'bad'}"><td>${r.pass ? 'PASS' : 'FAIL'}</td><td>${r.flow}</td><td>${r.view}</td><td>${seconds(r.ms)}</td><td>${esc(r.evidence)}${r.screenshot === undefined ? '' : `<br><img src="${r.screenshot}" alt="">`}</td></tr>`
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{background:#111;color:#ddd;font:14px/1.4 system-ui;margin:16px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #333;padding:6px;text-align:left;vertical-align:top}.ok td:first-child{color:#6c6}.bad td:first-child{color:#f66}img{max-width:420px;margin-top:6px}</style>
<h1>${esc(title)}</h1><table><tr><th></th><th>Flow</th><th>View</th><th>Time</th><th>Evidence</th></tr>${rows.map(row).join('')}</table>
<h2>Writes answered here (${writes.length})</h2><table>${writes.map((w) => `<tr class="${w.expected ? 'ok' : 'bad'}"><td>${w.rule}</td><td>${w.view}</td><td>${w.flow}</td><td>${w.method} ${esc(w.url)}</td></tr>`).join('')}</table>
<h2>CSP violations (${csp.length})</h2><table>${csp.map((c) => `<tr class="bad"><td>${c.view}</td><td>${c.flow}</td><td>${esc(c.what)}</td></tr>`).join('')}</table>`
}

export interface SmokeOutcome {
  pass: boolean
  report: string
}

/** Runs every flow against `url`; prints one line per flow and returns the verdict */
export const smoke = async (
  url: string,
  song?: string
): Promise<SmokeOutcome> => {
  const { origin } = new URL(url)
  const started = Date.now()
  const repo = repoAt(process.cwd())
  const dir = path.join(
    repo.main,
    '.reports',
    `${new Date().toISOString().slice(0, 10)}-smoke-${new URL(origin).hostname.split('.')[0]}`
  )
  mkdirSync(dir, { recursive: true })
  // Google Fonts from the bench's local copy: WebKit stalls on the live subsets (engines/browser.ts › replayFonts)
  replayFonts(storeDir(repo, 'bench', 'fixtures', 'fonts'))
  const picks = await pick(origin, song)
  console.log(
    `smoke ${origin}: library song ${describe(picks.library)}, search "${picks.query ?? ''}", chart song ${describe(picks.chart)}, not a song ${picks.notSong ?? 'none'}`
  )
  const log: Guard = { csp: [], flow: '', writes: [] }
  try {
    const perView = await Promise.all(
      ALL_VIEWS.map(async (view) => {
        const results: FlowResult[] = []
        for (const flow of FLOWS) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- one flow at a time per view; the views run side by side
          let result = await runFlow(flow, view, origin, picks, log, dir)
          if (result.network === true) {
            // oxlint-disable-next-line eslint/no-await-in-loop -- the same flow once more
            const again = await runFlow(
              flow,
              view,
              origin,
              picks,
              log,
              dir,
              true
            )
            result = { ...again, retried: result.evidence }
          }
          results.push(result)
        }
        return results
      })
    )
    const results = [...perView.flat(), await securityHeaders(origin, picks)]
    const unexpected = log.writes.filter((w) => !w.expected)
    const lines = [
      ...FLOWS.map((f) => f.name),
      'security-headers' as const,
    ].map((name) => {
      const runs = results.filter((r) => r.flow === name)
      const pass = runs.every((r) => r.pass)
      const detail = runs
        .map((r) =>
          r.view === 'http'
            ? r.evidence
            : `${r.view}: ${r.pass ? '' : 'FAIL '}${r.evidence}${r.retried === undefined ? '' : ' (retried after this machine lost its connection)'}`
        )
        .join(' | ')
      return {
        line: `${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(16)} ${detail}`,
        pass,
      }
    })
    const csp = {
      line: `${log.csp.length === 0 ? 'PASS' : 'FAIL'}  ${'csp'.padEnd(16)} ${log.csp.length} violations across ${results.length - 1} flow runs in ${ALL_VIEWS.length} views${log.csp.length > 0 ? `: ${log.csp[0].view} ${log.csp[0].flow} ${log.csp[0].what}` : ''}`,
      pass: log.csp.length === 0,
    }
    const writes = {
      line: `${unexpected.length === 0 ? 'PASS' : 'FAIL'}  ${'no-writes'.padEnd(16)} ${log.writes.length} writes answered here (${[...new Set(log.writes.filter((w) => w.expected).map((w) => w.rule))].join(', ')}), ${unexpected.length} blocked${
        unexpected.length > 0
          ? `: ${unexpected
              .map((w) => `${w.method} ${w.url} (${w.view} ${w.flow})`)
              .slice(0, 3)
              .join('; ')}`
          : ''
      }`,
      pass: unexpected.length === 0,
    }
    for (const l of [...lines, csp, writes]) {
      console.log(l.line)
    }
    const pass = [...lines, csp, writes].every((l) => l.pass)
    const title = `smoke ${pass ? 'PASS' : 'FAIL'} · ${origin} · ${new Date().toISOString().slice(0, 16)}`
    writeFileSync(
      path.join(dir, 'index.html'),
      html(title, results, log.writes, log.csp)
    )
    writeFileSync(
      path.join(dir, 'result.json'),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          csp: log.csp,
          origin,
          pass,
          picks: { ...picks, libraryIds: picks.libraryIds.size },
          results,
          wallMs: Date.now() - started,
          writes: log.writes,
        },
        null,
        2
      )
    )
    console.log(
      `smoke ${pass ? 'PASS' : 'FAIL'} in ${Math.round((Date.now() - started) / 1000)}s → ${path.join(dir, 'index.html')}`
    )
    return { pass, report: path.join(dir, 'index.html') }
  } finally {
    await closeBrowsers()
  }
}

declare global {
  interface Window {
    __smokeFill?: WeakMap<Element, number>
    __smokeCsp: (what: string) => Promise<void>
  }
}

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { song: { type: 'string' } },
  })
  const [url] = positionals
  if (url === undefined || !url.startsWith('https://')) {
    console.error(
      'usage: bun harness/smoke.ts <https://deployed-copy> [--song <library video id>], e.g. https://synbox.io'
    )
    process.exit(2)
  }
  const outcome = await smoke(url, values.song)
  process.exit(outcome.pass ? 0 : 1)
}
