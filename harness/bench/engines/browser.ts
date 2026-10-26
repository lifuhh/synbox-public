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
import type { Surface } from '../types'
import { RECORDER } from './recorder'

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
 * BrowserContext.route)
 */
export const open = async (
  surface: Surface,
  opts: { cpu?: number; serviceWorkers?: 'allow' | 'block' } = {}
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
  if (fontDir !== null) {
    const dir = fontDir
    await context.route(GOOGLE_FONTS, async (route) => {
      await fromFontCache(route, dir)
    })
  }
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
