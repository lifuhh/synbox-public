// Layout audit of one page on one screen: every visible press target is checked for size (WCAG 2.2's 24px
// minimum), for being covered at its centre by something else (a press would land on the wrong thing), for
// sticking out of the viewport, and, when fixed or sticky on a phone, for sitting under the status bar or home
// indicator. Uncaught page errors are counted too (a route that throws). Layout is deterministic: one run, on a
// page that has come to rest (signals, not sleeps: see `settle`).

import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { Locator, Page } from 'playwright'

import {
  ALL_VIEWS,
  mark,
  open,
  SAFARI_LANDSCAPE,
  SAFARI_NARROW,
  SAFARI_PORTRAIT,
} from '../engines/browser'
import type { Audit } from '../engines/recorder'
import { isRecord, parseJson } from '../json'
import type { BenchContext, Sample, Surface } from '../types'
import { pressNotes, pressScanIn, pressValues } from './press'

export interface LayoutPage {
  name: string
  /** The route in src/app.tsx this page is, as written there */
  route: string
  /** A URL to audit it at (a route with parameters gets a sample) */
  path: string
  /** `note` names the wait it is in, so an audit stuck for its time limit says where */
  ready: (page: Page, note?: (wait: string) => void) => Promise<void>
  /** UI states a user opens on this page, each audited as its own run (OPENED_STATES) */
  states?: OpenedState[]
}

/**
 * A control the audit presses: by its accessible role and name (what a screen reader announces), by its
 * `data-bench` hook, or by a `data-*` attribute other probes already rely on (`data-player-stage`). It must be on
 * screen, and only once: a missing or ambiguous control fails the audit, as a `data-bench` wait does
 */
export type Control =
  | { role: Parameters<Page['getByRole']>[0]; name: string | RegExp }
  | { bench: string }
  | { attr: string }

/** One thing a user does. `press` is a click with a mouse and a tap on a phone */
export type Step =
  | { press: Control }
  /** Moves the mouse onto it, at `at` from its top-left corner when given (else its centre) */
  | { hover: Control; at?: { x: number; y: number } }
  /** Presses a text field, which must then hold focus */
  | { focus: Control }
  /** Types into the focused field, replacing what it held */
  | { type: string }
  /** Waits for what the steps opened (a menu, a list, the controls) */
  | { shows: Control }

/** A UI state a user opens, audited like the page at rest: the same settle, checks and budgets, in `views` */
export interface OpenedState {
  name: string
  /** The views it is opened in (names from engines/browser.ts); the page's every view when omitted */
  views?: string[]
  steps: Step[]
}

export const PLAYER_SONG = '6rG_irmOQsM'

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

// The top bar's search: a field in the bar from 768px wide, a button that opens the field over the bar on a phone
// upright. Both open the instant results list once something is typed
const SEARCH_FIELD: OpenedState = {
  name: 'search-field',
  steps: [
    { focus: { name: 'Search Songs', role: 'combobox' } },
    { type: 'yo' },
    { shows: { name: 'Search Results', role: 'listbox' } },
  ],
  views: ['web', 'pwa-landscape', 'safari-landscape'],
}
const SEARCH_BUTTON: OpenedState = {
  name: 'search-button',
  steps: [
    { press: { name: 'Search', role: 'button' } },
    // The field opens focused, with the keyboard up: typing needs no press
    { type: 'yo' },
    { shows: { name: 'Search Results', role: 'listbox' } },
  ],
  views: ['pwa-portrait', 'safari-portrait'],
}

/**
 * The UI states a user opens, by route, each audited as its own run (`layout-<page>-<view>+<state>`). The top bar is
 * the same on every page, so its menus are opened on one ordinary page (not a tab page: the installed app's tab
 * bar takes their place there), and its search also on the player, whose watch page has the bar too (in a browser; the
 * installed app's upright player has none).
 */
export const OPENED_STATES: Record<string, OpenedState[]> = {
  '/lyrics/:videoId': [
    {
      // The reader's text size, weight and colours, in a bar along the bottom
      name: 'text-style',
      steps: [
        { press: { name: 'Text Style', role: 'button' } },
        { shows: { name: 'Larger Text', role: 'button' } },
      ],
      // Where the bar is most cramped
      views: ['pwa-landscape', 'safari-narrow'],
    },
  ],
  '/privacy': [
    SEARCH_FIELD,
    SEARCH_BUTTON,
    {
      name: 'notifications',
      steps: [
        { press: { name: /^Notifications/u, role: 'button' } },
        { shows: { name: 'Notifications', role: 'dialog' } },
      ],
    },
    {
      name: 'library',
      steps: [
        { press: { name: 'Library', role: 'button' } },
        { shows: { name: 'Library', role: 'dialog' } },
      ],
    },
    {
      // A guest's account menu (a signed-in user's is the same menu behind the avatar)
      name: 'more',
      steps: [
        { press: { name: 'More', role: 'button' } },
        { shows: { name: 'More', role: 'menu' } },
      ],
    },
  ],
  '/search': [
    {
      name: 'typed',
      steps: [
        { focus: { name: 'Search Songs', role: 'textbox' } },
        { type: 'aimer' },
      ],
    },
  ],
  '/v/:videoId': [
    { ...SEARCH_FIELD, views: ['web'] },
    // Safari only: the installed app's player held upright has no top bar (its Minimize Player and the drag down go
    // back to the tabs, where Search is)
    { ...SEARCH_BUTTON, views: ['safari-portrait'] },
    {
      // The floating UI over the lyrics, brought back by the pointer as by a tap; it hides again when idle. The
      // pointer stays off the video's centre, where the YouTube frame would take its moves
      name: 'controls',
      steps: [
        { at: { x: 60, y: 60 }, hover: { attr: 'data-player-stage' } },
        { shows: { name: 'Next', role: 'button' } },
      ],
    },
    {
      // Lock Landscape: the upright phone's page turned a quarter by CSS (page-turn.ts), the controls shown. Its
      // safe areas are swapped for the turn, and nothing else audited it (owner, 2026-10-26: a shade read as a haze
      // over the controls there)
      name: 'lock-landscape',
      steps: [
        { at: { x: 60, y: 60 }, hover: { attr: 'data-player-stage' } },
        { press: { name: 'Fullscreen', role: 'button' } },
        { at: { x: 60, y: 60 }, hover: { attr: 'data-player-stage' } },
        { press: { name: 'Lock Landscape', role: 'button' } },
        { shows: { name: 'Exit Fullscreen', role: 'button' } },
      ],
      views: ['pwa-portrait'],
    },
    {
      // Playback Speed's menu: above the bar's button, or left of the right-hand column's on a touch screen's
      // full-screen player; every speed the video allows must be reachable, none under the edge
      name: 'speed-menu',
      steps: [
        { at: { x: 60, y: 60 }, hover: { attr: 'data-player-stage' } },
        { press: { name: /^Playback Speed/u, role: 'button' } },
        { shows: { name: /^Playback Speed/u, role: 'menu' } },
      ],
    },
    {
      // A speed chosen: the menu closed, the controls up with the button showing the speed. The three views only:
      // in Safari at 320px a press on the controls brings up the small video's middle Previous, Pause and Next, which
      // the bar's box overlaps there (2026-10-26, not this button's doing: the bar's box is the same at 1×)
      name: 'speed-slowed',
      steps: [
        { at: { x: 60, y: 60 }, hover: { attr: 'data-player-stage' } },
        { press: { name: /^Playback Speed/u, role: 'button' } },
        { press: { name: '0.75×', role: 'menuitemradio' } },
        { at: { x: 60, y: 60 }, hover: { attr: 'data-player-stage' } },
        { shows: { name: 'Playback Speed 0.75×', role: 'button' } },
      ],
      views: ['web', 'pwa-portrait', 'pwa-landscape'],
    },
    {
      // Lyrics Style: a popover by the rail with a mouse, a dialog in the middle of a touch screen. Upright and
      // on the web the rail sits under the video, always there
      name: 'style',
      steps: [
        { press: { name: 'Lyrics Style', role: 'button' } },
        { shows: { name: 'Lyrics Style', role: 'dialog' } },
      ],
      views: ['web', 'pwa-portrait'],
    },
    {
      // On its side the rail floats over the video and shows with the controls
      name: 'style-floating',
      steps: [
        { at: { x: 60, y: 60 }, hover: { attr: 'data-player-stage' } },
        { shows: { name: 'Lyrics Style', role: 'button' } },
        { press: { name: 'Lyrics Style', role: 'button' } },
        { shows: { name: 'Lyrics Style', role: 'dialog' } },
      ],
      views: ['pwa-landscape'],
    },
    {
      // Lyrics Style on the Lock Landscape page: a dialog inside the page CSS turns a quarter, so its scroller's
      // axis and any pinned part follow the turn (owner, 2026-10-26: its sticky footer floated mid-panel there)
      name: 'lock-landscape-style',
      steps: [
        { at: { x: 60, y: 60 }, hover: { attr: 'data-player-stage' } },
        { press: { name: 'Fullscreen', role: 'button' } },
        { at: { x: 60, y: 60 }, hover: { attr: 'data-player-stage' } },
        { press: { name: 'Lock Landscape', role: 'button' } },
        { shows: { name: 'Exit Fullscreen', role: 'button' } },
        { press: { name: 'Lyrics Style', role: 'button' } },
        { shows: { name: 'Lyrics Style', role: 'dialog' } },
      ],
      views: ['pwa-portrait'],
    },
    {
      // Upright, the lyrics window under the video expands to fill the screen under it (a tap on its lines, or
      // Expand Lyrics in its corner), with Lyrics Style and Minimize Lyrics in that corner
      name: 'lyrics-expanded',
      steps: [
        { press: { name: 'Expand Lyrics', role: 'button' } },
        { shows: { name: 'Minimize Lyrics', role: 'button' } },
      ],
      views: ['pwa-portrait', 'safari-portrait'],
    },
  ],
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
      await settle(page)
      await toTitle()
    },
    route: '/',
  },
  {
    name: 'player',
    path: `/v/${PLAYER_SONG}`,
    ready: async (page, note) => {
      note?.('the YouTube iframe (mark player-iframe)')
      await mark(page, 'player-iframe', 30_000)
      note?.('the player out of loading, starting and buffering')
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
      // On a phone on its side the stage shows only the current lines, so the song's intro (about 14 s here) held
      // the audit back. The player's own shortcut skips ahead 5 s a press until a line shows
      for (let skips = 0; skips < 4; skips += 1) {
        note?.(`a lyrics line, skip ${skips + 1} of 4`)
        // oxlint-disable-next-line eslint/no-await-in-loop -- one press, then a look
        const shown = await mark(page, 'lyrics-line', 1000).then(
          () => true,
          () => false
        )
        if (shown) {
          break
        }
        note?.(`ArrowRight to skip ahead, ${skips + 1} of 4`)
        // oxlint-disable-next-line eslint/no-await-in-loop -- one press at a time
        await page.keyboard.press('ArrowRight')
      }
      note?.('a lyrics line (mark lyrics-line)')
      await mark(page, 'lyrics-line', 30_000)
      note?.('the pointer onto the stage')
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
  // The page before a search: the field and the suggestion pills, a sideways row on a phone. Unaudited until
  // 2026-10-26, when two pills over empty space shipped unseen. Its opened states are the searched page's
  {
    name: 'search-rest',
    path: '/search',
    ready: async (page) => {
      await settled(page)
      await page.getByRole('list', { name: 'Examples' }).waitFor()
    },
    route: '/search',
    states: [],
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
    ...LAYOUT_PAGES.filter((p) => routes.includes(p.route)).map((p) => ({
      ...p,
      states: p.states ?? OPENED_STATES[p.route],
    })),
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
        states: OPENED_STATES[route],
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
  const views = new Set(
    [...ALL_VIEWS, SAFARI_PORTRAIT, SAFARI_LANDSCAPE, SAFARI_NARROW].map(
      (v) => v.name
    )
  )
  const badViews = Object.entries(OPENED_STATES).flatMap(([route, states]) =>
    states.flatMap((st) =>
      (st.views ?? [])
        .filter((v) => !views.has(v))
        .map(
          (v) =>
            `opened state "${st.name}" on ${route} names view "${v}", which is not one (${[...views].join(', ')})`
        )
    )
  )
  return [
    ...badViews,
    ...[
      ...LAYOUT_PAGES.map((p) => p.route),
      ...Object.keys(samples),
      ...Object.keys(skip),
      ...Object.keys(OPENED_STATES),
    ]
      .filter((route) => !routes.includes(route))
      .map(
        (route) =>
          `${route} is listed for the layout audits but is not a route in src/app.tsx`
      ),
  ]
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
  'insetSurfaces',
  'panXPx',
  'zoomInputs',
  'clippedText',
  'unnamedControls',
  'unscrollableRegions',
  'smoothScrollReduced',
  'detachedMenus',
  'actsOnPress',
  'actsOnReleaseOutside',
  'badPressOk',
] as const

/** How far an open menu may sit from what can be seen of its button before the audit counts it detached */
const DETACHED_MENU_PX = 12

const routeMatches = (route: string, pathname: string): boolean =>
  new RegExp(`^${route.replaceAll(/:[^/]+/gu, '[^/]+')}/?$`, 'u').test(pathname)

/** The audit for any URL of the app: its route's own readiness when it has one (`/` is home), else settled */
export const pageAt = (url: URL): LayoutPage => {
  const own = LAYOUT_PAGES.find((p) => routeMatches(p.route, url.pathname))
  const route =
    own?.route ??
    Object.keys(OPENED_STATES).find((r) => routeMatches(r, url.pathname)) ??
    url.pathname
  return {
    name: own?.name ?? 'page',
    path: `${url.pathname}${url.search}`,
    ready: own?.ready ?? settled,
    route,
    states: OPENED_STATES[route],
  }
}

const STEP_TIMEOUT_MS = 10_000

/** A page's errors as notes; those after the first `counted` came during the press scan, and aren't counted */
const errorNotes = (kind: string, all: string[], counted: number): string[] =>
  all.map(
    (m, i) =>
      `${kind}${i >= counted ? ' (during the press scan, not counted)' : ''}: ${m}`
  )

const controlName = (c: Control): string => {
  if ('bench' in c) {
    return `[data-bench=${c.bench}]`
  }
  if ('attr' in c) {
    return `[${c.attr}]`
  }
  return `${c.role} "${String(c.name)}"`
}

const stepName = (step: Step): string => {
  if ('type' in step) {
    return `type "${step.type}"`
  }
  if ('press' in step) {
    return `press ${controlName(step.press)}`
  }
  if ('hover' in step) {
    return `hover ${controlName(step.hover)}`
  }
  if ('focus' in step) {
    return `focus ${controlName(step.focus)}`
  }
  return `shows ${controlName(step.shows)}`
}

/** Why an element is not on screen as a person sees it (no box, outside the viewport, hidden, faded out with an
 * ancestor), or '' when it is */
const notShown = (el: Element): string => {
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) {
    return `no box (${Math.round(r.width)}×${Math.round(r.height)})`
  }
  if (
    r.bottom <= 0 ||
    r.right <= 0 ||
    r.top >= innerHeight ||
    r.left >= innerWidth
  ) {
    return `outside the viewport at ${Math.round(r.x)},${Math.round(r.y)}`
  }
  if (getComputedStyle(el).visibility === 'hidden') {
    return 'visibility: hidden'
  }
  let opacity = 1
  for (let p: Element | null = el; p; p = p.parentElement) {
    opacity *= Number(getComputedStyle(p).opacity)
  }
  return opacity > 0.5 ? '' : `faded out (opacity ${opacity.toFixed(2)})`
}

/** The one on-screen match of a control, waited for; none, or more than one, fails the audit and says which */
const onScreen = async (
  page: Page,
  c: Control,
  waitMs = STEP_TIMEOUT_MS
): Promise<Locator> => {
  let all: Locator
  if ('bench' in c) {
    all = page.locator(`[data-bench="${c.bench}"]`)
  } else if ('attr' in c) {
    all = page.locator(`[${c.attr}]`)
  } else {
    all = page.getByRole(c.role, { exact: true, name: c.name })
  }
  const deadline = Date.now() + waitMs
  for (;;) {
    const shown: Locator[] = []
    const why: string[] = []
    // oxlint-disable-next-line eslint/no-await-in-loop -- polled until the control shows
    for (const l of await all.all()) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- each match in turn
      const reason = await l
        .evaluate(notShown)
        .catch((error: unknown) => `gone (${String(error).split('\n')[0]})`)
      if (reason === '') {
        shown.push(l)
      } else {
        why.push(reason)
      }
    }
    if (shown.length === 1) {
      return shown[0]
    }
    if (shown.length > 1) {
      throw new Error(
        `${controlName(c)} is on screen ${shown.length} times; name one`
      )
    }
    if (Date.now() > deadline) {
      throw new Error(
        `${controlName(c)} never showed within ${waitMs}ms (${why.length === 0 ? 'no such element' : why.join('; ')})`
      )
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- polled until the control shows
    await page.waitForTimeout(100)
  }
}

/** Opens a state: each step in turn, as a person would (a tap on a phone, a click with a mouse) */
const openState = async (
  page: Page,
  state: OpenedState,
  touch: boolean
): Promise<void> => {
  for (const [i, step] of state.steps.entries()) {
    const fail = (why: string) =>
      new Error(
        `opened state "${state.name}", step ${i + 1} (${stepName(step)}): ${why}`
      )
    try {
      if ('type' in step) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- steps run in order
        const field = await page.evaluate(() => {
          const a = document.activeElement
          if (
            a instanceof HTMLInputElement ||
            a instanceof HTMLTextAreaElement
          ) {
            a.select()
            return true
          }
          return false
        })
        if (!field) {
          throw new Error('no text field has focus')
        }
        // oxlint-disable-next-line eslint/no-await-in-loop -- steps run in order
        await page.keyboard.type(step.type)
      } else if ('shows' in step) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- steps run in order
        await onScreen(page, step.shows)
      } else if ('hover' in step) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- steps run in order
        const l = await onScreen(page, step.hover)
        // oxlint-disable-next-line eslint/no-await-in-loop -- steps run in order
        await l.hover({
          force: true,
          position: step.at,
          timeout: STEP_TIMEOUT_MS,
        })
      } else {
        const control = 'press' in step ? step.press : step.focus
        // oxlint-disable-next-line eslint/no-await-in-loop -- steps run in order
        const l = await onScreen(page, control)
        // oxlint-disable-next-line eslint/no-await-in-loop -- steps run in order
        await (touch
          ? l.tap({ timeout: STEP_TIMEOUT_MS })
          : l.click({ timeout: STEP_TIMEOUT_MS }))
        if (
          'focus' in step &&
          // oxlint-disable-next-line eslint/no-await-in-loop -- steps run in order
          !(await l.evaluate((e) => e === document.activeElement))
        ) {
          throw new Error('pressed, but it did not take focus')
        }
      }
    } catch (error) {
      throw fail(
        (error instanceof Error ? error.message : String(error)).split('\n')[0]
      )
    }
  }
}

/** One run of an audit; `at` says what it is doing, for the time limit */
const auditOnce = async (
  p: LayoutPage,
  surface: Surface,
  url: string,
  shot: string,
  at: { step: string },
  state?: OpenedState
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
    at.step = 'loading the page'
    await page.goto(url, { waitUntil: 'commit' })
    at.step = 'waiting for the page to get ready'
    // When an error ends the wait first, the readiness that times out later is moot
    const ready = (async () => {
      try {
        await p.ready(page, (wait) => {
          at.step = `waiting for the page to get ready: ${wait}`
        })
        return null
      } catch (error) {
        return error
      }
    })()
    const outcome = await Promise.race([ready, firstError])
    if (outcome instanceof Error) {
      throw outcome
    }
    at.step = 'waiting for the layout to rest'
    let unsettled = await settle(page)
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
    if (state !== undefined) {
      at.step = `opening ${state.name}`
      await page.evaluate(() => {
        window.__bench.rest()
      })
      await openState(page, state, surface.kind === 'phone')
      unsettled = await settle(page)
      // What the state opened must still be open when the audit looks, or the audit would pass on the page at rest
      const opened = state.steps.findLast((step) => 'shows' in step)
      if (opened !== undefined && 'shows' in opened) {
        await onScreen(page, opened.shows, 0).catch((error: unknown) => {
          throw new Error(
            `opened state "${state.name}" closed again before the audit: ${error instanceof Error ? error.message : String(error)}`
          )
        })
      }
    }
    at.step = 'auditing'
    const audit: Audit = await page.evaluate(
      (s) => window.__bench.audit(s),
      safe
    )
    // An open menu or popover sits next to what can be seen of its button: the button's box when it paints a
    // surface, else its icons and text (a bare glyph's box is mostly empty). Farther than DETACHED_MENU_PX reads as
    // a pane from nowhere (owner, 2026-10-26, and on a turned page 2026-10-25)
    at.step = 'measuring open menus against their buttons'
    const detached: string[] = await page.evaluate((limit) => {
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page, where nothing outside this function exists
      const drawn = (button: Element): DOMRect => {
        const box = button.getBoundingClientRect()
        const color = getComputedStyle(button).backgroundColor
        const [, afterSlash] = color.split('/')
        const parts = color.match(/[\d.]+/gu) ?? []
        let alpha = 1
        if (color === 'transparent') {
          alpha = 0
        } else if (afterSlash !== undefined) {
          alpha = Number(/[\d.]+/u.exec(afterSlash)?.[0] ?? 1)
        } else if (color.startsWith('rgba')) {
          alpha = Number(parts.at(-1))
        }
        if (alpha >= 0.3) {
          return box
        }
        const rects = [...button.querySelectorAll('svg')].map((svg) =>
          svg.getBoundingClientRect()
        )
        const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
          if ((n.textContent ?? '').trim() !== '') {
            const range = document.createRange()
            range.selectNodeContents(n)
            rects.push(range.getBoundingClientRect())
          }
        }
        // Over 1px: screen-reader-only text is a 1px box (as src/lib/menu-offset.ts)
        const seen = rects.filter((r) => r.width > 1 && r.height > 1)
        if (seen.length === 0) {
          return box
        }
        const left = Math.min(...seen.map((r) => r.left))
        const top = Math.min(...seen.map((r) => r.top))
        return new DOMRect(
          left,
          top,
          Math.max(...seen.map((r) => r.right)) - left,
          Math.max(...seen.map((r) => r.bottom)) - top
        )
      }
      return [
        ...document.querySelectorAll(
          '[data-radix-popper-content-wrapper] > [id]'
        ),
      ]
        .filter((menu) => menu.getBoundingClientRect().width > 0)
        .flatMap((menu) => {
          const button = document.querySelector(`[aria-controls="${menu.id}"]`)
          if (button === null) {
            return []
          }
          const a = drawn(button)
          const b = menu.getBoundingClientRect()
          const gap = Math.max(
            b.left - a.right,
            a.left - b.right,
            b.top - a.bottom,
            a.top - b.bottom,
            0
          )
          return gap > limit
            ? [
                `${Math.round(gap)}px from ${button.getAttribute('aria-label') ?? button.textContent ?? 'its button'}`,
              ]
            : []
        })
    }, DETACHED_MENU_PX)
    at.step = 'taking the screenshot'
    await page.screenshot({ path: shot })
    // With Reduce Motion on, nothing may still scroll smoothly (a focus or a tap on the bar would glide): every
    // scrolling box and the page, read under the emulated setting, then the setting put back
    at.step = 'reading scroll behaviour under Reduce Motion'
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const smooth: string[] = await page.evaluate(() =>
      [document.documentElement, ...document.querySelectorAll('body *')]
        .filter(
          (el) =>
            getComputedStyle(el).scrollBehavior === 'smooth' &&
            (el === document.documentElement ||
              el.scrollHeight > el.clientHeight + 4 ||
              el.scrollWidth > el.clientWidth + 4)
        )
        .map(
          (el) =>
            `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(/\s+/u).slice(0, 4).join('.')}`
        )
    )
    await page.emulateMedia({ reducedMotion: null })
    const phase = await page.evaluate(
      () =>
        document.querySelector<HTMLElement>('[data-player-stage]')?.dataset
          .phase
    )
    // Errors the page made on its own: the press scan below may make the page throw (a synthetic touch has no real
    // pointer to capture), which is the scan's doing, noted but not counted
    const pageErrors = thrown.length
    const consoleErrors = logged.length
    // Last, as it presses things: when each control acts, in the website and the installed app (press.ts)
    at.step = 'pressing each control (press timing)'
    const press = await pressScanIn(page, surface)
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
      ...audit.insetSurfaces.map(
        (t) =>
          `painted in a safe-area inset at ${t.rect.x},${t.rect.y} ${t.rect.w}×${t.rect.h}: ${t.label}`
      ),
      ...audit.zoomInputs.map(
        (t) =>
          `text field under 16px (iOS zooms on focus) at ${t.rect.x},${t.rect.y} ${t.rect.w}×${t.rect.h}: ${t.label}`
      ),
      ...audit.clipped.map(
        (t) =>
          `clipped text at ${t.rect.x},${t.rect.y} ${t.rect.w}×${t.rect.h}: ${t.label}`
      ),
      ...audit.unnamed.map(
        (t) =>
          `no accessible name at ${t.rect.x},${t.rect.y} ${t.rect.w}×${t.rect.h}: ${t.label}`
      ),
      ...audit.unscrollable.map(
        (t) =>
          `scrolls, but a keyboard can't reach it, at ${t.rect.x},${t.rect.y} ${t.rect.w}×${t.rect.h}: ${t.label}`
      ),
      ...smooth.map(
        (label) => `scrolls smoothly under Reduce Motion: ${label}`
      ),
      ...detached.map((label) => `menu opened ${label}`),
      ...(audit.overflowX
        ? [`page scrolls sideways by ${audit.overflowX}px`]
        : []),
      ...(audit.pan.px > 0
        ? [`page panned sideways by ${audit.pan.px}px (${audit.pan.detail})`]
        : []),
      ...pressNotes(press),
      ...errorNotes('page error', thrown, pageErrors),
      ...errorNotes('console error', logged, consoleErrors),
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
            ...pressValues(press),
            clippedText: audit.clipped.length,
            consoleErrors,
            detachedMenus: detached.length,
            insetSurfaces: audit.insetSurfaces.length,
            occludedTargets: audit.occluded.length,
            offscreenTargets: audit.offscreen.length,
            overflowXPx: audit.overflowX,
            pageErrors,
            panXPx: audit.pan.px,
            smallTargets: audit.small.length,
            smoothScrollReduced: smooth.length,
            targets: audit.targets,
            unnamedControls: audit.unnamed.length,
            unsafeTargets: audit.unsafe.length,
            unscrollableRegions: audit.unscrollable.length,
            zoomInputs: audit.zoomInputs.length,
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
    at.step = 'closing the page'
    await close()
  }
}

/**
 * An audit that has run this long is stuck (a WebKit call that never returns), not slow: it fails and says where,
 * and `check` runs it once more. A normal audit takes 1-5 s; the player's longest real waits add up to 44 s (the
 * iframe 30, the phase 10, four 1 s looks). 90 -> 45 on 2026-10-24: a WebKit player audit stuck in a 1 s wait about
 * once in three full runs, and each cost the whole limit before its retry passed in 4 s
 */
const AUDIT_LIMIT_MS = 45_000

/** One page at one URL on one screen, its screenshot saved to `shot` */
export const auditPage = async (
  p: LayoutPage,
  surface: Surface,
  url: string,
  shot: string,
  state?: OpenedState
): Promise<{ samples: Sample[]; errors: string[] }> => {
  const at = { step: 'opening the page' }
  let timer: ReturnType<typeof setTimeout> | undefined
  // oxlint-disable-next-line promise/avoid-new -- settles when the limit passes
  const stuck = new Promise<{ samples: Sample[]; errors: string[] }>(
    (resolve) => {
      timer = setTimeout(() => {
        resolve({
          errors: [
            `audit stuck for ${AUDIT_LIMIT_MS / 1000}s while ${at.step}`,
          ],
          samples: [],
        })
      }, AUDIT_LIMIT_MS)
    }
  )
  try {
    return await Promise.race([
      auditOnce(p, surface, url, shot, at, state),
      stuck,
    ])
  } finally {
    clearTimeout(timer)
  }
}

export const layoutAudit =
  (p: LayoutPage, surface: Surface, state?: OpenedState) =>
  async (ctx: BenchContext): Promise<{ samples: Sample[]; errors: string[] }> =>
    await auditPage(
      p,
      surface,
      `${ctx.origin}${p.path}`,
      path.join(ctx.artifactDir, 'screen.png'),
      state
    )
