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
import { isRecord, parseJson } from '../json'
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

/**
 * console.error lines that say nothing about the app: an error the app logs (an ErrorBoundary that caught a crash,
 * a failed fetch it reports) counts, these don't. Keep the list short and say why for each
 */
const BENIGN_CONSOLE: RegExp[] = [
  // The browser's own network log, not app code: the bench server answers only the routes netlify.toml proxies
  // (the auth Worker's /api/songs/listens is not one), and a failed request the app cares about is its own error
  /^Failed to load resource:/u,
]

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
]

interface RouteConfig {
  samples: Record<string, string>
  skip: Record<string, string>
}

const isRouteConfig = (v: unknown): v is RouteConfig =>
  isRecord(v) &&
  isRecord(v.samples) &&
  isRecord(v.skip) &&
  [...Object.values(v.samples), ...Object.values(v.skip)].every(
    (x) => typeof x === 'string'
  )

/** harness/routes.json: sample URLs for routes with parameters, and routes that get no audit */
export const routeConfig = (): RouteConfig =>
  parseJson(
    readFileSync(path.resolve(import.meta.dir, '../../routes.json'), 'utf-8'),
    isRouteConfig,
    'harness/routes.json'
  )

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
  const { samples, skip } = routeConfig()
  const known = new Set(LAYOUT_PAGES.map((p) => p.route))
  const found = routes.filter((route) => !known.has(route) && !(route in skip))
  return [
    // Lenient here (an entry whose route is gone audits nothing); `check` fails on it first (routeProblems)
    ...LAYOUT_PAGES.filter((p) => routes.includes(p.route)),
    ...found.map((route) => {
      const sample = samples[route] ?? (route.includes(':') ? null : route)
      return {
        name:
          route
            .slice(1)
            .replaceAll(/:[^/]+/gu, '')
            .replaceAll(/\/+/gu, '-')
            .replace(/-$/u, '') || 'index',
        path: sample ?? route,
        ready:
          sample === null
            ? () => {
                throw new Error(
                  `route ${route} has no layout audit: add a sample URL for it to harness/routes.json › samples, or a reason to › skip`
                )
              }
            : settled,
        route,
      }
    }),
  ]
}

/**
 * Why the audit list can't be trusted: the router file yielded no routes (its syntax changed), or a route named in
 * LAYOUT_PAGES or harness/routes.json is not in it. Either way audits would silently go missing.
 */
export const routeProblems = (): string[] => {
  const routes = appRoutes()
  if (routes.length === 0) {
    return [
      'no routes found in src/app.tsx (appRoutes reads `path="…"` and `<Route index`)',
    ]
  }
  const { samples, skip } = routeConfig()
  return [
    ...LAYOUT_PAGES.map((p) => p.route),
    ...Object.keys(samples),
    ...Object.keys(skip),
  ]
    .filter((route) => !routes.includes(route))
    .map(
      (route) =>
        `${route} is listed for the layout audits but is not a route in src/app.tsx`
    )
}

/** The counts an audit gates on (budget 0 unless harness/budgets.json says otherwise); `targets` is only reported */
export const LAYOUT_FINDINGS = [
  'overflowXPx',
  'occludedTargets',
  'smallTargets',
  'offscreenTargets',
  'unsafeTargets',
  'pageErrors',
  'consoleErrors',
] as const

const routeMatches = (route: string, pathname: string): boolean =>
  new RegExp(`^${route.replaceAll(/:[^/]+/gu, '[^/]+')}/?$`, 'u').test(pathname)

/** The audit for any URL of the app: its route's own readiness when it has one (`/` is home), else settled */
export const pageAt = (url: URL): LayoutPage => {
  const own = LAYOUT_PAGES.find((p) => routeMatches(p.route, url.pathname))
  return {
    name: own?.name ?? 'page',
    path: `${url.pathname}${url.search}`,
    ready: own?.ready ?? settled,
    route: own?.route ?? url.pathname,
  }
}

/** One page at one URL on one screen, its screenshot saved to `shot` */
export const auditPage = async (
  p: LayoutPage,
  surface: Surface,
  url: string,
  shot: string
): Promise<{ samples: Sample[]; errors: string[] }> => {
  const { origin } = new URL(url)
  const { page, close, safe } = await open(surface)
  // The first app error ends the wait for the page's readiness: a crashed page never fires its marks, and its
  // error is the finding, so it is audited (and fails on its error count) at once instead of timing out
  let errored: (() => void) | null = null
  // oxlint-disable-next-line promise/avoid-new -- settles on the first error event
  const firstError = new Promise<void>((resolve) => {
    errored = resolve
  })
  const thrown: string[] = []
  page.on('pageerror', (error) => {
    // WebKit reports a ResizeObserver callback deferred to the next frame as an error; it is not the app throwing
    if (!error.message.startsWith('ResizeObserver loop')) {
      thrown.push(error.message.split('\n')[0])
      errored?.()
    }
  })
  const logged: string[] = []
  page.on('console', (message) => {
    const [text] = message.text().split('\n')
    const from = message.location().url
    // The app's own scripts only: the YouTube player's scripts log their own complaints (seen: "Unable to post
    // message to https://www.youtube-nocookie.com", once in three runs)
    if (
      message.type() === 'error' &&
      from.startsWith(origin) &&
      !BENIGN_CONSOLE.some((b) => b.test(text))
    ) {
      logged.push(`${text} (${from})`)
      errored?.()
    }
  })
  try {
    await page.goto(url, { waitUntil: 'commit' })
    // When an error ends the wait first, the readiness that times out later is moot
    const ready = (async () => {
      try {
        await p.ready(page)
        return null
      } catch (error) {
        return error
      }
    })()
    const outcome = await Promise.race([ready, firstError])
    if (outcome instanceof Error) {
      throw outcome
    }
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
    await page.screenshot({ path: shot })
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
      ...audit.offscreen.map((t) => `off-screen at x=${t.rect.x}: ${t.label}`),
      ...audit.unsafe.map(
        (t) =>
          `in a safe-area inset at ${t.rect.x},${t.rect.y} ${t.rect.w}×${t.rect.h}: ${t.label}`
      ),
      ...(audit.overflowX
        ? [`page scrolls sideways by ${audit.overflowX}px`]
        : []),
      ...thrown.map((m) => `page error: ${m}`),
      ...logged.map((m) => `console error: ${m}`),
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
            consoleErrors: logged.length,
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
    await page.screenshot({ path: shot }).catch(() => {
      // The run already failed; a missing screenshot of it changes nothing
    })
    const message = error instanceof Error ? error.message : String(error)
    return { errors: [message.split('\n')[0]], samples: [] }
  } finally {
    await close()
  }
}

export const layoutAudit =
  (p: LayoutPage, surface: Surface) =>
  async (ctx: BenchContext): Promise<{ samples: Sample[]; errors: string[] }> =>
    await auditPage(
      p,
      surface,
      `${ctx.origin}${p.path}`,
      path.join(ctx.artifactDir, 'screen.png')
    )
