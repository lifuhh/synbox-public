// Playwright contexts for probes. Every run gets a fresh context (cold cache, no storage), the app's randomness
// seeded (the gallery shuffles), Sentry blocked, Google Fonts replayed, and an in-page recorder for marks,
// frames and layout.

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { chromium, webkit } from 'playwright'
import type { Browser, BrowserContext, Page, Route } from 'playwright'

import { isRecord, parseJson } from '../json'
import {
  backendOrigins,
  benchOrigins,
  liveLookup,
  replayedGet,
} from '../replay'
import { repoAt, storeDir } from '../store'
import type { Surface } from '../types'
import { RECORDER } from './recorder'
import { silenceAllMedia } from './silence'

const GOOGLE_FONTS = /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//u
// The writes a plain visit makes to the site's counters, on any origin (a local build proxies /api to the live
// Worker): a song's listen (src/lib/song-stats.ts › countListen) and the usage events (src/lib/usage.ts)
const SITE_COUNTERS = /\/api\/(?:songs\/[\w-]{11}\/listen|events)(?:\?|$)/u
let fontDir: string | null = null

/**
 * Google Fonts answered from a local copy, recorded on first use. Live, Playwright's WebKit stalled on the ~60
 * parallel Noto Sans JP subset requests, so fonts never finished loading and every screenshot timed out
 * (2026-10-22), and font downloads were timing noise on every engine. The stylesheet differs by browser, so it is
 * keyed by user agent too; the font files are not.
 */
export const replayFonts = (dir: string): void => {
  mkdirSync(dir, { recursive: true })
  fontDir = dir
}

const fromFontCache = async (route: Route, dir: string): Promise<void> => {
  const request = route.request()
  const url = request.url()
  const agent = url.includes('fonts.googleapis.com')
    ? ((await request.headerValue('user-agent')) ?? '')
    : ''
  const file = path.join(
    dir,
    createHash('sha256').update(`${url}\n${agent}`).digest('hex').slice(0, 24)
  )
  if (!existsSync(file)) {
    const response = await fetch(url, { headers: { 'user-agent': agent } })
    if (!response.ok) {
      await route.abort()
      return
    }
    const body = Buffer.from(await response.arrayBuffer())
    const type = response.headers.get('content-type') ?? ''
    writeFileSync(`${file}.json`, JSON.stringify({ type, url }))
    writeFileSync(`${file}.tmp`, body)
    renameSync(`${file}.tmp`, file)
  }
  const { type } = parseJson(
    readFileSync(`${file}.json`, 'utf-8'),
    (v): v is { type: string } => isRecord(v) && typeof v.type === 'string',
    `font fixture ${file}.json`
  )
  await route.fulfill({
    body: readFileSync(file),
    headers: {
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=31536000',
      'content-type': type,
    },
  })
}

interface LookupReads {
  dir: string
  /** The recorded address a read is replayed from, or null for a request that is not a lookup read */
  key: (url: URL) => string | null
}
let lookupReads: LookupReads | null = null

/**
 * The reads that reach the lookup service, wherever the page asks for them: the service itself (a build with the live
 * address: the dev server, the local site), the gallery's song list (`/api/library/songs`: the dev server's proxy, the
 * local site's Netlify function) and karaoke timing from the Worker (`<api>/api/karaoke/<id>`), each keyed as the
 * bench server records it (server.ts › proxiesFrom), so all share one set of fixtures. The dev server's own karaoke
 * stand-in is left alone: it reads the local backend when one runs
 */
const readsOfLookup = (): LookupReads => {
  if (lookupReads === null) {
    const repo = repoAt(import.meta.dir)
    const { lookup, api } = backendOrigins(repo.top)
    const lookupOrigin = new URL(lookup).origin
    const apiOrigin = new URL(api).origin
    lookupReads = {
      dir: storeDir(repo, 'bench', 'fixtures'),
      key: (url) => {
        if (url.origin === lookupOrigin) {
          return url.href
        }
        // A bench server answers its own /api from the same fixtures, and is timed doing it
        if (benchOrigins.has(url.origin)) {
          return null
        }
        if (url.pathname === '/api/library/songs') {
          return `${lookup}/library/songs${url.search}`
        }
        if (
          url.origin === apiOrigin &&
          url.pathname.startsWith('/api/karaoke/')
        ) {
          return url.href
        }
        return null
      },
    }
  }
  return lookupReads
}

const fromLookupFixtures = async (
  route: Route,
  reads: LookupReads
): Promise<void> => {
  const request = route.request()
  const key = reads.key(new URL(request.url()))
  const origin = await request.headerValue('origin')
  // The page may be on another origin (localhost) and send credentials, so CORS names it rather than *
  const cors: Record<string, string> =
    origin === null
      ? {}
      : {
          'access-control-allow-credentials': 'true',
          'access-control-allow-origin': origin,
          vary: 'Origin',
        }
  if (key === null) {
    await route.fallback()
  } else if (request.method() === 'OPTIONS') {
    await route.fulfill({
      headers: {
        ...cors,
        'access-control-allow-headers':
          (await request.headerValue('access-control-request-headers')) ?? '*',
        'access-control-allow-methods': 'GET',
      },
      status: 204,
    })
  } else if (request.method() === 'GET') {
    const { answer } = await replayedGet(
      reads.dir,
      key,
      await request.headerValue('accept'),
      true
    )
    await route.fulfill({
      body: answer.body,
      headers: {
        ...cors,
        'cache-control': 'no-store',
        'content-type': answer.contentType,
      },
      status: answer.status,
    })
  } else {
    await route.fallback()
  }
}

const SAFE = {
  landscape: { bottom: 21, left: 47, right: 47, top: 0 },
  narrow: { bottom: 0, left: 0, right: 0, top: 0 },
  portrait: { bottom: 34, left: 0, right: 0, top: 47 },
}

/** A phone's screen: its orientation's, or the 320px one */
const phoneKey = (surface: Extract<Surface, { kind: 'phone' }>) =>
  surface.narrow === true ? 'narrow' : surface.orientation

export const VIEWPORTS = {
  desktop: { height: 900, width: 1440 },
  landscape: { height: 390, width: 844 },
  narrow: { height: 568, width: 320 },
  portrait: { height: 844, width: 390 },
}

/** A named screen pages are opened on: by the layout audits in `check`, and by `harness/views.ts` */
export interface View {
  name: string
  label: string
  surface: Surface
}

const view = (name: string, surface: Surface): View => {
  const { width, height } =
    surface.kind === 'phone' ? VIEWPORTS[phoneKey(surface)] : VIEWPORTS.desktop
  const where =
    surface.kind === 'desktop'
      ? 'Chromium'
      : `WebKit, ${surface.installed === true ? 'installed app' : 'Safari'}`
  return { label: `${where}, ${width}×${height}`, name, surface }
}

const PORTRAIT = {
  engine: 'webkit',
  kind: 'phone',
  orientation: 'portrait',
} as const
const LANDSCAPE = { ...PORTRAIT, orientation: 'landscape' } as const

export const WEB = view('web', { engine: 'chromium', kind: 'desktop' })
export const PWA_PORTRAIT = view('pwa-portrait', {
  ...PORTRAIT,
  installed: true,
})
export const PWA_LANDSCAPE = view('pwa-landscape', {
  ...LANDSCAPE,
  installed: true,
})
export const SAFARI_PORTRAIT = view('safari-portrait', PORTRAIT)
export const SAFARI_LANDSCAPE = view('safari-landscape', LANDSCAPE)
/** iPhone Safari at 320px wide, where every page must still fit (WCAG 1.4.10 reflow): at rest and its states */
export const SAFARI_NARROW = view('safari-narrow', {
  ...PORTRAIT,
  narrow: true,
})

/**
 * "All views" (AGENTS.md): every UI change is checked in these three. The website on a monitor, and the app installed
 * on an iPhone (navigator.standalone) upright and on its side, each phone with the iPhone's safe areas
 */
export const ALL_VIEWS: View[] = [WEB, PWA_PORTRAIT, PWA_LANDSCAPE]

const browsers = new Map<string, Promise<Browser>>()

const launch = async (engine: Surface['engine']): Promise<Browser> => {
  let b = browsers.get(engine)
  if (!b) {
    b =
      engine === 'chromium'
        ? chromium.launch({
            args: [
              '--autoplay-policy=no-user-gesture-required',
              '--mute-audio',
            ],
            channel: 'chrome',
          })
        : webkit.launch()
    browsers.set(engine, b)
  }
  return await b
}

export const browserVersions = async (): Promise<{ chrome: string }> => {
  const chrome = await launch('chromium')
  return { chrome: chrome.version() }
}

export const closeBrowsers = async (): Promise<void> => {
  await Promise.all(
    [...browsers.values()].map(async (b) => {
      const browser = await b
      await browser.close()
    })
  )
  browsers.clear()
}

/**
 * A page in Playwright's own Chromium, not the bench's Google Chrome, silenced like every other context: on macOS
 * Chrome follows the system's Keyboard Navigation setting, which by default makes Tab skip buttons and links, so a
 * keyboard journey (probes/keyboard.ts) runs here. Its own browser, closed with the page
 */
export const openPlainChromium = async (viewport: {
  width: number
  height: number
}): Promise<{ page: Page; close: () => Promise<void> }> => {
  const browser = await chromium.launch({ args: ['--mute-audio'] })
  const context = await browser.newContext({ viewport })
  await context.addInitScript(silenceAllMedia)
  const page = await context.newPage()
  return {
    close: async () => {
      await browser.close()
    },
    page,
  }
}

export interface Opened {
  context: BrowserContext
  page: Page
  /** Phone safe areas injected into the page, so layout checks can test against them */
  safe: { top: number; bottom: number; left: number; right: number }
  close: () => Promise<void>
}

/**
 * `cpu`: slowdown for Chromium surfaces; WebKit has no equivalent and runs at full speed. `serviceWorkers: 'block'`
 * for a caller that must see every request: a route never sees what a service worker fetches (Playwright docs,
 * BrowserContext.route). `lookup`: the lookup service's reads come from the bench's fixtures (`replay`, unless
 * SYNBOX_LIVE_LOOKUP=1) or from the service (`live`: the smoke test of a deployed copy)
 */
export const open = async (
  surface: Surface,
  opts: {
    cpu?: number
    serviceWorkers?: 'allow' | 'block'
    lookup?: 'replay' | 'live'
  } = {}
): Promise<Opened> => {
  const browser = await launch(surface.engine)
  const phone = surface.kind === 'phone'
  const viewport = phone ? VIEWPORTS[phoneKey(surface)] : VIEWPORTS.desktop
  const context = await browser.newContext({
    deviceScaleFactor: phone ? 3 : 1,
    hasTouch: phone,
    isMobile: phone,
    serviceWorkers: opts.serviceWorkers ?? 'allow',
    viewport,
  })
  await context.route(/sentry\.io/u, async (route) => {
    await route.abort()
  })
  // A page visit counts a listen and sends usage events to the live auth Worker. Every run is a fresh browser, so a
  // new guest device: before this, the bench's player song (6rG_irmOQsM) gained ~2,200 listens (2026-10-27). Answered
  // here, as harness/smoke.ts › WRITE_RULES does, so no run adds to the numbers
  await context.route(SITE_COUNTERS, async (route) => {
    await (route.request().method() === 'POST'
      ? route.fulfill({ json: { ok: true } })
      : route.fallback())
  })
  // The lookup service scales to zero and is billed while it is up; test runs kept it awake most of the day
  // (2026-10-27), so a run reads what an earlier one recorded and wakes it only for a read nobody has recorded
  if ((opts.lookup ?? (liveLookup() ? 'live' : 'replay')) === 'replay') {
    const reads = readsOfLookup()
    await context.route(
      (url) => reads.key(url) !== null,
      async (route) => {
        await fromLookupFixtures(route, reads)
      }
    )
  }
  if (fontDir !== null) {
    const dir = fontDir
    await context.route(GOOGLE_FONTS, async (route) => {
      await fromFontCache(route, dir)
    })
  }
  // Before anything else, so no frame plays a sound: WebKit has no --mute-audio
  await context.addInitScript(silenceAllMedia)
  await context.addInitScript(RECORDER)
  const safe = phone
    ? SAFE[phoneKey(surface)]
    : { bottom: 0, left: 0, right: 0, top: 0 }
  if (phone) {
    // Playwright reports no safe areas, and the app reads env(safe-area-inset-*) both through its own variables
    // and directly (Tailwind inlines `pt-safe-top`). Rewriting every env() in the page's stylesheets to the
    // iPhone's insets reproduces what Safari computes, wherever the app reads it.
    await context.addInitScript((inset) => {
      const env =
        /env\(\s*safe-area-inset-(?<side>top|bottom|left|right)\s*(?:,[^()]*(?:\([^()]*\))?[^()]*)?\)/gu
      const done = new WeakSet<CSSStyleSheet>()
      const rewrite = (rules: CSSRuleList) => {
        for (const rule of rules) {
          if (rule instanceof CSSStyleRule || rule instanceof CSSFontFaceRule) {
            const { style } = rule
            for (let i = 0; i < style.length; i += 1) {
              const name = style.item(i)
              const value = style.getPropertyValue(name)
              if (value.includes('safe-area-inset')) {
                style.setProperty(
                  name,
                  value.replace(
                    env,
                    (_, side: keyof typeof inset) => `${inset[side]}px`
                  ),
                  style.getPropertyPriority(name)
                )
              }
            }
          }
          if ('cssRules' in rule && rule.cssRules instanceof CSSRuleList) {
            rewrite(rule.cssRules)
          }
        }
      }
      const apply = () => {
        for (const sheet of document.styleSheets) {
          if (!done.has(sheet)) {
            try {
              rewrite(sheet.cssRules)
              done.add(sheet)
            } catch {
              // A cross-origin sheet (Google Fonts) can't be read and has no insets
            }
          }
        }
      }
      document.addEventListener('DOMContentLoaded', apply)
      document.addEventListener('load', apply, true)
      new MutationObserver(apply).observe(document, {
        childList: true,
        subtree: true,
      })
    }, safe)
  }
  if (phone && surface.installed === true) {
    // iOS reports an app opened from the Home Screen through navigator.standalone, which the app reads for its
    // installed layout (src/lib/pwa.ts › isStandalone). CSS `display-mode: standalone` can't be emulated; the app
    // uses it only to work around an iOS bug the lab doesn't have
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'standalone', {
        configurable: true,
        get: () => true,
      })
    })
  }
  const page = await context.newPage()
  if (surface.engine === 'chromium' && opts.cpu !== undefined && opts.cpu > 1) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.cpu })
  }
  return {
    close: async () => {
      await context.close()
    },
    context,
    page,
    safe,
  }
}

/** Waits for a recorder mark and returns its time (ms after navigation start), or throws with what was seen */
export const mark = async (
  page: Page,
  name: string,
  timeoutMs = 30_000
): Promise<number> => {
  const handle = await page
    // Polled on a timer, not on animation frames: inside a full check a WebKit player page sometimes stopped
    // running frames, and a 1 s look then never returned until the audit's time limit (2026-10-24, 3 in 13 runs)
    .waitForFunction((n) => window.__bench.marks[n], name, {
      polling: 100,
      timeout: timeoutMs,
    })
    .catch(async () => {
      const seen = await page.evaluate(() => Object.keys(window.__bench.marks))
      throw new Error(
        `mark "${name}" never fired within ${timeoutMs}ms; saw: ${seen.join(', ') || 'none'}`
      )
    })
  return await handle.jsonValue()
}
