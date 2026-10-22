// Layout audit of one page on one screen: every visible press target is checked for size (WCAG 2.2's 24px
// minimum), for being covered at its centre by something else (a press would land on the wrong thing), for
// sticking out of the viewport, and, when fixed or sticky on a phone, for sitting under the status bar or home
// indicator. Uncaught page errors are counted too (a route that throws). Layout is deterministic: one run, on a
// page that has come to rest (signals, not sleeps: see `settle`).

import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { Page } from 'playwright'

import { mark, open } from '../engines/browser'
import type { Audit } from '../engines/recorder'
import type { BenchContext, Sample, Surface } from '../types'

export interface LayoutPage {
  name: string
  /** The route in src/app.tsx this page is, as written there */
  route: string
  /** A URL to audit it at (a route with parameters gets a sample) */
  path: string
  ready: (page: Page) => Promise<void>
}

const PLAYER_SONG = '6rG_irmOQsM'

/** Waits for the layout to rest (recorder.ts › settle); a page that never rests is audited as it is, with a note */
const settle = async (page: Page): Promise<string | null> =>
  await page.evaluate(async () => await window.__bench.settle(5000))

// The page has rendered and whatever it fetched has arrived: no region still says it is busy
const settled = async (page: Page) => {
  await mark(page, 'topbar')
  await mark(page, 'page')
  await page
    .waitForFunction(
      () => document.querySelector('[aria-busy=true]') === null,
      null,
      { timeout: 10_000 }
    )
    .catch(() => {
      // A region that stays busy is audited as it is
    })
}

// The player's passing states; the audit waits until it is out of them
const PASSING_PHASES = ['loading', 'starting', 'buffering']

/** Pages with their own readiness; every other route in src/app.tsx is audited once settled */
export const LAYOUT_PAGES: LayoutPage[] = [
  {
    name: 'home',
    path: '/',
    ready: async (page) => {
      await mark(page, 'carousel-slide')
      await mark(page, 'charts-row')
    },
    route: '/',
  },
  {
    name: 'gallery',
    path: '/',
    ready: async (page) => {
      // Tiles lazy-load their images, so on a short screen they only load once scrolled to. The sections above
      // must have their content first: scrolling before they grow leaves the title far below the viewport
      const toTitle = async () => {
        await page.evaluate(() =>
          document
            .querySelector('#gallery-title')
            ?.scrollIntoView({ block: 'start' })
        )
      }
      await mark(page, 'carousel-slide')
      await mark(page, 'charts-done')
      await toTitle()
      await mark(page, 'gallery-tile')
      await settle(page)
      await toTitle()
    },
    route: '/',
  },
  {
    name: 'player',
    path: `/v/${PLAYER_SONG}`,
    ready: async (page) => {
      await mark(page, 'lyrics-line', 30_000)
      // WebKit in Playwright may never play the video; audit whatever the player settled into, controls shown
      await page
        .waitForFunction(
          (passing) =>
            !passing.includes(
              document.querySelector<HTMLElement>('[data-player-stage]')
                ?.dataset.phase ?? 'loading'
            ),
          PASSING_PHASES,
          { timeout: 10_000 }
        )
        .catch(() => {
          // A player stuck loading is audited as it is; its phase is in the notes
        })
      await page
        .locator('[data-player-stage]')
        .hover({ force: true, position: { x: 40, y: 40 } })
        .catch(() => {
          // The hover only brings the controls back; audit the page either way
        })
    },
    route: '/v/:videoId',
  },
  {
    name: 'search',
    path: '/search?q=yoasobi',
    ready: async (page) => {
      await mark(page, 'search-result', 30_000)
    },
    route: '/search',
  },
  {
    name: 'reader',
    path: `/lyrics/${PLAYER_SONG}`,
    ready: async (page) => {
      await mark(page, 'lyrics-line', 30_000)
    },
    route: '/lyrics/:videoId',
  },
  {
    name: 'versions',
    path: `/v/${PLAYER_SONG}/versions`,
    ready: settled,
    route: '/v/:videoId/versions',
  },
]

/** Routes in src/app.tsx that get no audit, and why */
export const LAYOUT_SKIP: Record<string, string> = {
  '/admin': 'admins only; the lab has no session',
  '/lab/stage': 'development builds only',
  '/offline': 'redirects to /lyrics',
  '/offline/:videoId': 'redirects to /lyrics/:videoId',
  '/playlists/:playlistId':
    "a playlist lives in the browser's storage, and a fresh lab context has none",
}

/** The routes src/app.tsx declares: the index route as `/`, every other by its `path` */
export const appRoutes = (): string[] => {
  const source = readFileSync(
    path.resolve(import.meta.dir, '../../../src/app.tsx'),
    'utf-8'
  )
  const paths = [...source.matchAll(/\bpath=['"](?<route>[^'"]+)['"]/gu)].map(
    (m) => m.groups?.route ?? ''
  )
  return [...(/<Route\s+index\b/u.test(source) ? ['/'] : []), ...paths].filter(
    (route) => route !== '*'
  )
}

/**
 * Every route gets an audit: its own entry in LAYOUT_PAGES, or, with no parameters, a generic one that waits for
 * the page to settle. A route with parameters and no entry can't be audited without a sample, so it yields a
 * page whose audit fails and says what to add.
 */
export const layoutPages = (): LayoutPage[] => {
  const routes = appRoutes()
  const known = new Set(LAYOUT_PAGES.map((p) => p.route))
  const found = routes.filter(
    (route) => !known.has(route) && !(route in LAYOUT_SKIP)
  )
  return [
    // An entry whose route is gone (or not yet added) audits nothing
    ...LAYOUT_PAGES.filter((p) => routes.includes(p.route)),
    ...found.map((route) => ({
      name: route.slice(1).replaceAll(/[/:]+/gu, '-') || 'index',
      path: route,
      ready: route.includes(':')
        ? () => {
            throw new Error(
              `route ${route} has no layout audit: add it to LAYOUT_PAGES in harness/bench/probes/layout.ts with a sample URL, or to LAYOUT_SKIP with the reason`
            )
          }
        : settled,
      route,
    })),
  ]
}

export const layoutAudit =
  (p: LayoutPage, surface: Surface) =>
  async (
    ctx: BenchContext
  ): Promise<{ samples: Sample[]; errors: string[] }> => {
    const { page, close, safe } = await open(surface)
    const thrown: string[] = []
    page.on('pageerror', (error) => {
      // WebKit reports a ResizeObserver callback deferred to the next frame as an error; it is not the app throwing
      if (!error.message.startsWith('ResizeObserver loop')) {
        thrown.push(error.message.split('\n')[0])
      }
    })
    try {
      await page.goto(`${ctx.origin}${p.path}`, { waitUntil: 'commit' })
      await p.ready(page)
      const unsettled = await settle(page)
      if (
        surface.kind === 'phone' &&
        surface.installed === true &&
        !(await page.evaluate(() =>
          Object.hasOwn(document.documentElement.dataset, 'installed')
        ))
      ) {
        throw new Error(
          'installed-app emulation failed: the page did not set data-installed'
        )
      }
      const audit: Audit = await page.evaluate(
        (s) => window.__bench.audit(s),
        safe
      )
      await page.screenshot({ path: path.join(ctx.artifactDir, 'screen.png') })
      const phase = await page.evaluate(
        () =>
          document.querySelector<HTMLElement>('[data-player-stage]')?.dataset
            .phase
      )
      const notes = [
        ...audit.small.map(
          (t) =>
            `small ${t.rect.w}×${t.rect.h} at ${t.rect.x},${t.rect.y}: ${t.label}`
        ),
        ...audit.occluded.map((o) => `covered: ${o.label} under ${o.by}`),
        ...audit.offscreen.map(
          (t) => `off-screen at x=${t.rect.x}: ${t.label}`
        ),
        ...audit.unsafe.map(
          (t) =>
            `in a safe-area inset at ${t.rect.x},${t.rect.y} ${t.rect.w}×${t.rect.h}: ${t.label}`
        ),
        ...(audit.overflowX
          ? [`page scrolls sideways by ${audit.overflowX}px`]
          : []),
        ...thrown.map((m) => `page error: ${m}`),
        ...(unsettled === null ? [] : [`not settled: ${unsettled}`]),
        ...(phase !== undefined && phase !== ''
          ? [`player phase at audit: ${phase}`]
          : []),
      ]
      return {
        errors: [],
        samples: [
          {
            notes,
            values: {
              occludedTargets: audit.occluded.length,
              offscreenTargets: audit.offscreen.length,
              overflowXPx: audit.overflowX,
              pageErrors: thrown.length,
              smallTargets: audit.small.length,
              targets: audit.targets,
              unsafeTargets: audit.unsafe.length,
            },
          },
        ],
      }
    } catch (error) {
      await page
        .screenshot({ path: path.join(ctx.artifactDir, 'screen.png') })
        .catch(() => {
          // The run already failed; a missing screenshot of it changes nothing
        })
      const message = error instanceof Error ? error.message : String(error)
      return { errors: [message.split('\n')[0]], samples: [] }
    } finally {
      await close()
    }
  }
