// Layout audit of one page on one screen: every visible press target is checked for size (WCAG 2.2's 24px
// minimum), for being covered at its centre by something else (a press would land on the wrong thing), for
// sticking out of the viewport, and, when fixed or sticky on a phone, for sitting under the status bar or home
// indicator. Landmark positions are recorded so a move can be reported. Layout is deterministic: one run.

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

// Whatever the page fetched has arrived: no region still says it is busy, then a moment for images and fonts
const settled = async (page: Page) => {
  await mark(page, 'topbar')
  await page
    .waitForFunction(
      () => document.querySelector('[aria-busy=true]') === null,
      null,
      { timeout: 10_000 }
    )
    .catch(() => {
      // A region that stays busy is audited as it is
    })
  await page.waitForTimeout(1000)
}

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
      await toTitle()
      await page.waitForTimeout(800)
    },
    route: '/',
  },
  {
    name: 'player',
    path: `/v/${PLAYER_SONG}`,
    ready: async (page) => {
      await mark(page, 'lyrics-line', 30_000)
      // WebKit in Playwright may never play the video; audit whatever the player settled into, controls shown
      await page.waitForTimeout(3000)
      await page
        .locator('[data-player-stage]')
        .hover({ force: true, position: { x: 40, y: 40 } })
        .catch(() => {
          // The hover only brings the controls back; audit the page either way
        })
      await page.waitForTimeout(400)
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
      await page.waitForTimeout(800)
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
  const known = new Set(LAYOUT_PAGES.map((p) => p.route))
  const found = appRoutes().filter(
    (route) => !known.has(route) && !(route in LAYOUT_SKIP)
  )
  return [
    ...LAYOUT_PAGES,
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

const auditOnce =
  (p: LayoutPage, surface: Surface) =>
  async (
    ctx: BenchContext
  ): Promise<{ samples: Sample[]; errors: string[] }> => {
    const { page, close, safe } = await open(surface)
    try {
      await page.goto(`${ctx.origin}${p.path}`, { waitUntil: 'commit' })
      await p.ready(page)
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
        ...(phase !== undefined && phase !== ''
          ? [`player phase at audit: ${phase}`]
          : []),
      ]
      return {
        errors: [],
        samples: [
          {
            landmarks: audit.landmarks,
            notes,
            values: {
              occludedTargets: audit.occluded.length,
              offscreenTargets: audit.offscreen.length,
              overflowXPx: audit.overflowX,
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

/**
 * One retry: the audit is a single run, and a live YouTube player that never finishes loading (seen once in four
 * runs of the desktop player) would otherwise fail the gate on its own. A retried audit says so in its notes.
 */
export const layoutAudit =
  (p: LayoutPage, surface: Surface) =>
  async (
    ctx: BenchContext
  ): Promise<{ samples: Sample[]; errors: string[] }> => {
    const first = await auditOnce(p, surface)(ctx)
    if (first.errors.length === 0) {
      return first
    }
    const second = await auditOnce(p, surface)(ctx)
    return {
      ...second,
      samples: second.samples.map((sample) => ({
        ...sample,
        notes: [...(sample.notes ?? []), `retried after: ${first.errors[0]}`],
      })),
    }
  }
