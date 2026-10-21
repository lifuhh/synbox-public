// Playwright contexts for probes. Every run gets a fresh context (cold cache, no storage), the app's randomness
// seeded (the gallery shuffles), Sentry blocked, and an in-page recorder for marks, frames and layout.

import { chromium, webkit } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'

import type { Surface } from '../types'
import { RECORDER } from './recorder'

const SAFE = {
  landscape: { bottom: 21, left: 47, right: 47, top: 0 },
  portrait: { bottom: 34, left: 0, right: 0, top: 47 },
}

export const VIEWPORTS = {
  desktop: { height: 900, width: 1440 },
  landscape: { height: 390, width: 844 },
  portrait: { height: 844, width: 390 },
}

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

/** CPU slowdown for Chromium surfaces; WebKit has no equivalent and runs at full speed */
export const open = async (
  surface: Surface,
  opts: { cpu?: number } = {}
): Promise<Opened> => {
  const browser = await launch(surface.engine)
  const phone = surface.kind === 'phone'
  const viewport = phone ? VIEWPORTS[surface.orientation] : VIEWPORTS.desktop
  const context = await browser.newContext({
    deviceScaleFactor: phone ? 3 : 1,
    hasTouch: phone,
    isMobile: phone,
    serviceWorkers: 'allow',
    viewport,
  })
  await context.route(/sentry\.io/u, async (route) => {
    await route.abort()
  })
  await context.addInitScript(RECORDER)
  const safe = phone
    ? SAFE[surface.orientation]
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
    .waitForFunction((n) => window.__bench.marks[n], name, {
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

/** A fixed JS workload; its time before and after a run shows whether the machine's speed drifted */
export const speedProbe = (): number => {
  const start = performance.now()
  let x = 0
  for (let i = 0; i < 30_000_000; i += 1) {
    x = (x + i * 7) % 1_000_003
  }
  if (x < 0) {
    throw new Error('unreachable')
  }
  return Math.round(performance.now() - start)
}
