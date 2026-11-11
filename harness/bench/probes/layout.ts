// Layout audit of one page on one screen: every visible press target is checked for size (WCAG 2.2's 24px
// minimum), for being covered at its centre by something else (a press would land on the wrong thing), for
// sticking out of the viewport, and, when fixed or sticky on a phone, for sitting under the status bar or home
// indicator. Uncaught page errors are counted too (a route that throws). Layout is deterministic: one run, on a
// page that has come to rest (signals, not sleeps: see `settle`).

import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { Locator, Page, Request } from 'playwright'

import {
  ALL_VIEWS,
  mark,
  open,
  RELAY_ERROR,
  SAFARI_LANDSCAPE,
  SAFARI_NARROW,
  SAFARI_PORTRAIT,
  YOUTUBE_IFRAME_API,
} from '../engines/browser'
import type { Audit } from '../engines/recorder'
import { isRecord, parseJson } from '../json'
import type { BenchContext, Sample, Surface } from '../types'
import { ICON_ALIGN_LIMIT_PX, iconTextOffsets } from './icon-align'
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
  /** Types into the focused field, replacing what it held; `paste` puts it in at once, as a paste does */
  | { type: string; paste?: true }
  /** Waits for what the steps opened (a menu, a list, the controls) */
  | { shows: Control }

/** A UI state a user opens, audited like the page at rest: the same settle, checks and budgets, in `views` */
export interface OpenedState {
  name: string
  /** The views it is opened in (names from engines/browser.ts); the page's every view when omitted */
  views?: string[]
  /** Opened as a signed-in listener (SIGNED_IN), for controls a guest doesn't get */
  signedIn?: true
  /** With a song generating, held part way through translation (holdGeneration) */
  generating?: true
  steps: Step[]
}

// A listener with an empty library, as the auth Worker answers: what a signed-in state's page sees. Only GETs are
// answered; a write (library or settings sync) gets a bare 204
const SIGNED_IN: Record<string, unknown> = {
  '/api/me': {
    quota: {
      limit: 5,
      request: null,
      resetsAt: '2099-01-01T00:00:00.000Z',
      used: 2,
    },
    timeZone: 'UTC',
    user: {
      email: 'listener@example.com',
      id: 'bench',
      image: null,
      name: 'Bench',
      role: 'user',
    },
  },
  '/api/me/feedback': { feedback: [] },
  '/api/me/fixes': { fixes: [] },
  '/api/me/library': { bookmarks: [], history: [], playlists: [] },
  '/api/me/prefs': { prefs: {} },
  '/api/me/songs': { songs: [] },
}

export const signIn = async (page: Page) => {
  await page.route(/\/api\/me(?:\/|$|\?)/u, async (route) => {
    const request = route.request()
    const body = SIGNED_IN[new URL(request.url()).pathname]
    await (request.method() === 'GET' && body !== undefined
      ? route.fulfill({ json: body })
      : route.fulfill({ status: 204 }))
  })
}

export const PLAYER_SONG = '6rG_irmOQsM'
/**
 * A start inside PLAYER_SONG's first line (14.8 s to 19.6 s in its karaoke timing), for a link's `?t=`: the player
 * reports a link's start from the moment it is built, before any video arrives, so the stage shows that line without
 * the video playing or a seek landing. The first line is where the audits always measured: their 5 s skips landed
 * there. A player that starts playing there reaches the next line 4.6 s later
 */
export const PLAYER_LINE_SEC = 15

/**
 * Where the player's layout audits open PLAYER_SONG (`?t=`): inside its line from about 26 s to 34 s, so the player
 * draws a line from the moment it is built and keeps it for 7 s of playback, past most audits. Opened at the top,
 * the first line waited for 15 s of playback. The start is picked for WebKit, whose video stalls in `starting` for
 * some starts and then errors: at 15 s in 13 of 19 pages, at 63 s (the longest early line) in 11 of 70, at 27 s and
 * 30 s in none of 29, from the top in none of 22 (2026-11-11/12). A stalled player draws no Previous, Play and Next
 */
export const PLAYER_AUDIT_SEC = 27

/**
 * Karaoke Style's two rows on the player's stage, held still, on a page opened at PLAYER_LINE_SEC once the player is
 * ready: two rows on the stage for half a second (the time reads the start, then 0, then the start again as the
 * player begins). From then on, whenever the player plays it is paused from inside the page, by a click on the
 * controls' own Play/Pause (its togglePlay; no pointer or key, which would show the controls), within 50 ms: the
 * video starts whenever it arrives, 2 s to 16 s after the page opens (Chromium the slower), and at most once per
 * page. Until then a player still starting holds the link's start.
 *
 * Not by skipping ahead: 5 s presses from the intro (about 14 s here) reached a line only once YouTube had landed the
 * seek before (it holds a seek asked for while one is still loading) and played the rest. On 2026-11-11, under load,
 * a seek took 10 s to land and playback then stalled at 13 s for 30 s more, so 3 of 6 pages had no rows after 8
 * presses. Nor by waiting for the video to play before pausing it: that is most of a page's time in Chromium
 */
export const twoRowsHeld = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    setInterval(() => {
      const phase = document.querySelector<HTMLElement>('[data-player-stage]')
        ?.dataset.phase
      if (phase === 'playing' || phase === 'buffering') {
        document
          .querySelector<HTMLButtonElement>(
            '[data-player-chrome] button[aria-label=Pause], [data-player-chrome] button[aria-label=Play]'
          )
          ?.click()
      }
    }, 50)
  })
  await page
    .waitForFunction(
      (holdMs) => {
        // Since when the two rows have been on the stage, kept across the polls
        const held = document.documentElement.dataset
        if (document.querySelectorAll('[data-lyric-row]').length !== 2) {
          delete held.benchRowsSince
          return false
        }
        held.benchRowsSince ??= String(performance.now())
        return performance.now() - Number(held.benchRowsSince) >= holdMs
      },
      500,
      { polling: 50, timeout: 10_000 }
    )
    .catch(async () => {
      const seen = await page.evaluate(() => ({
        phase:
          document.querySelector<HTMLElement>('[data-player-stage]')?.dataset
            .phase ?? 'none',
        rows: document.querySelectorAll('[data-lyric-row]').length,
      }))
      throw new Error(
        `Karaoke Style's two rows never showed (${seen.rows} rows, player ${seen.phase})`
      )
    })
}

/**
 * A song generating, as a reload finds it: its job in the stored queue (src/lib/generation/queue.ts › STORAGE_KEY),
 * running the translate phase, and its /translate-annotate stream answered in the page. The stream replays the
 * translation call reporting 60 %, then holds with a heartbeat every 5 s, as the backend does. No request
 * reaches the backend, and nothing is saved
 */
export const holdGeneration = async (page: Page) => {
  const job = {
    ahead: 0,
    id: 'bench-generation',
    mode: 'new',
    reconnectingSince: null,
    requestId: 'bench-generation',
    runs: {},
    seen: false,
    skipUploaderLyrics: false,
    startedAt: Date.now(),
    status: { kind: 'running', phase: 'translate' },
    title: 'Bench Song',
    video: {
      channel: 'Bench',
      durationS: 240,
      thumbnail: `https://i.ytimg.com/vi/${PLAYER_SONG}/hqdefault.jpg`,
      title: 'Bench Song',
    },
    videoId: PLAYER_SONG,
  }
  /* oxlint-disable unicorn/consistent-function-scoping -- runs in the page: nothing outside this function is there */
  await page.addInitScript(
    (stored) => {
      if (localStorage.getItem('synbox:generations') === null) {
        localStorage.setItem('synbox:generations', stored)
      }
      const progress = (stage: string, extra: object) =>
        `${JSON.stringify({ data: { stage, ...extra }, type: 'progress' })}\n`
      const replay = [
        progress('translate', { expected_s: 380, fraction: 0 }),
        progress('translate', { fraction: 0.6 }),
      ]
      const encoder = new TextEncoder()
      const held = () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const line of replay) {
                controller.enqueue(encoder.encode(line))
              }
              setInterval(() => {
                controller.enqueue(
                  encoder.encode('{"type":"heartbeat","data":null}\n')
                )
              }, 5000)
            },
          }),
          { headers: { 'content-type': 'application/x-ndjson' }, status: 200 }
        )
      const real = window.fetch.bind(window)
      const urlOf = (input: RequestInfo | URL) => {
        if (typeof input === 'string') {
          return input
        }
        return input instanceof URL ? input.href : input.url
      }
      // Defined, not assigned: the harness's types are Bun's, whose fetch has more members than a browser's
      Object.defineProperty(window, 'fetch', {
        configurable: true,
        value: async (input: RequestInfo | URL, init?: RequestInit) =>
          new URL(urlOf(input), location.href).pathname.endsWith(
            '/translate-annotate'
          )
            ? held()
            : await real(input, init),
      })
    },
    JSON.stringify({ jobs: [job], v: 1 })
  )
  /* oxlint-enable unicorn/consistent-function-scoping */
}

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

/**
 * Where a state's pointer goes on the player's stage to bring the controls back, from its top-left corner: bare stage
 * in every view, controls shown or not (measured 2026-11-12). Off the video's centre, where the YouTube frame would
 * take its moves. It was (60, 60) until then, which on a phone on its side is the rail floating over the stage: the
 * move counted as leaving the player, so the controls showed only when something else had just woken them (the
 * video starting, A231)
 */
const STAGE_POINT = { x: 200, y: 60 }
/** The same on an upright phone's full-screen player, whose rail is a row across its top (y 47 to 99) while it shows */
const FULL_SCREEN_POINT = { x: 200, y: 160 }

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
  // Home's field with something in it: its action button changes with what was typed or pasted (Search, play a
  // song that has lyrics, Generate Lyrics for one that hasn't). The play label matches either name it has had
  '/': [
    {
      name: 'field-search',
      steps: [
        { focus: { bench: 'hero-input' } },
        { type: 'aimer' },
        // The top bar has its own Search button on a phone; the field stays the hook
        { shows: { bench: 'hero-input' } },
      ],
    },
    {
      name: 'field-play',
      steps: [
        { focus: { bench: 'hero-input' } },
        { paste: true, type: `https://youtu.be/${PLAYER_SONG}` },
        { shows: { name: /^Play (?:Video|Song)$/u, role: 'button' } },
      ],
    },
    {
      name: 'field-generate',
      steps: [
        { focus: { bench: 'hero-input' } },
        { paste: true, type: 'https://youtu.be/dQw4w9WgXcQ' },
        { shows: { name: 'Generate Lyrics', role: 'button' } },
      ],
    },
  ],
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
      // The bell and the Library menu are a signed-in listener's
      name: 'notifications',
      signedIn: true,
      steps: [
        { press: { name: /^Notifications/u, role: 'button' } },
        { shows: { name: 'Notifications', role: 'dialog' } },
      ],
    },
    {
      // The same panel with a song generating (holdGeneration): its step drum, on a phone on its side too
      generating: true,
      name: 'generating',
      signedIn: true,
      steps: [
        { press: { name: /^Notifications/u, role: 'button' } },
        { shows: { name: 'Notifications', role: 'dialog' } },
      ],
    },
    {
      name: 'library',
      signedIn: true,
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
    {
      // Contact Me's dialog from the guest's menu: the owner's address to copy
      name: 'contact',
      steps: [
        { press: { name: 'More', role: 'button' } },
        { press: { name: 'Contact Me', role: 'menuitem' } },
        { shows: { name: 'Contact Me', role: 'dialog' } },
      ],
    },
    {
      // The same dialog for an account: the form, with the field iOS must not zoom into
      name: 'contact-form',
      signedIn: true,
      steps: [
        { press: { name: 'Account', role: 'button' } },
        { press: { name: 'Contact Me', role: 'menuitem' } },
        { shows: { name: 'Contact Me', role: 'dialog' } },
      ],
    },
    {
      // Send Feedback from the guest's menu: always anonymous, a note where an account's checkbox goes
      name: 'feedback',
      steps: [
        { press: { name: 'More', role: 'button' } },
        { press: { name: 'Send Feedback', role: 'menuitem' } },
        { shows: { name: 'Send Feedback', role: 'dialog' } },
      ],
    },
    {
      // The same dialog for an account: Send Anonymously and its note share Send's row (one centre line, even when
      // the note wraps on a phone)
      name: 'feedback-form',
      signedIn: true,
      steps: [
        { press: { name: 'Account', role: 'button' } },
        { press: { name: 'Send Feedback', role: 'menuitem' } },
        { shows: { name: 'Send Feedback', role: 'dialog' } },
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
        { at: STAGE_POINT, hover: { attr: 'data-player-stage' } },
        { shows: { name: 'Next', role: 'button' } },
      ],
    },
    {
      // Lock Landscape: the upright phone's page turned a quarter by CSS (page-turn.ts), the controls shown. Its
      // safe areas are swapped for the turn, and nothing else audited it (owner, 2026-10-26: a shade read as a haze
      // over the controls there)
      name: 'lock-landscape',
      steps: [
        { at: STAGE_POINT, hover: { attr: 'data-player-stage' } },
        { press: { name: 'Fullscreen', role: 'button' } },
        { at: FULL_SCREEN_POINT, hover: { attr: 'data-player-stage' } },
        { press: { name: 'Lock Landscape', role: 'button' } },
        { shows: { name: 'Exit Fullscreen', role: 'button' } },
      ],
      views: ['pwa-portrait'],
    },
    {
      // Theater Mode on the wide watch page: the video across both columns, the lyrics panel under it, Up Next moved
      // down beside the song
      name: 'theater',
      steps: [
        { at: STAGE_POINT, hover: { attr: 'data-player-stage' } },
        { press: { name: 'Theater Mode', role: 'button' } },
        { at: STAGE_POINT, hover: { attr: 'data-player-stage' } },
        { shows: { name: 'Default View', role: 'button' } },
      ],
      views: ['web'],
    },
    {
      // The pointer resting on the bar's last button, where a label above it has the least room (the stage's right
      // edge): whatever the bar shows for a hovered button must stay whole and cover no other control
      name: 'control-tip',
      steps: [
        { at: STAGE_POINT, hover: { attr: 'data-player-stage' } },
        { hover: { name: /^(?:Exit )?Full ?screen$/iu, role: 'button' } },
        { shows: { name: /^(?:Exit )?Full ?screen$/iu, role: 'button' } },
      ],
      views: ['web'],
    },
    {
      // Playback Speed's menu: above the bar's button, or left of the right-hand column's on a touch screen's
      // full-screen player; every speed the video allows must be reachable, none under the edge
      name: 'speed-menu',
      steps: [
        { at: STAGE_POINT, hover: { attr: 'data-player-stage' } },
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
        { at: STAGE_POINT, hover: { attr: 'data-player-stage' } },
        { press: { name: /^Playback Speed/u, role: 'button' } },
        { press: { name: '0.75×', role: 'menuitemradio' } },
        { at: STAGE_POINT, hover: { attr: 'data-player-stage' } },
        { shows: { name: 'Playback Speed 0.75×', role: 'button' } },
      ],
      views: ['web', 'pwa-portrait', 'pwa-landscape'],
    },
    {
      // Lyrics Style: a popover by the rail under the video on the wide watch page. Only there: a narrow watch page
      // draws no lyrics over its video, and its rail is losing the lyrics toggles and Lyrics Style (feat/text-style).
      // The full-screen player's rail keeps them (style-floating, lock-landscape-style)
      name: 'style',
      steps: [
        { press: { name: 'Lyrics Style', role: 'button' } },
        { shows: { name: 'Lyrics Style', role: 'dialog' } },
      ],
      views: ['web'],
    },
    {
      // Text Style, for the lyrics on the page: a popover from the Lyrics panel's header with a mouse, opening out over
      // the video; a sheet from the corner of the band under the video on an upright phone
      name: 'text-style',
      steps: [
        { press: { name: 'Text Style', role: 'button' } },
        { shows: { name: 'Text Style', role: 'dialog' } },
      ],
      views: ['web', 'pwa-portrait', 'safari-portrait'],
    },
    {
      // On its side the rail floats over the video and shows with the controls
      name: 'style-floating',
      steps: [
        { at: STAGE_POINT, hover: { attr: 'data-player-stage' } },
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
        { at: STAGE_POINT, hover: { attr: 'data-player-stage' } },
        { press: { name: 'Fullscreen', role: 'button' } },
        { at: FULL_SCREEN_POINT, hover: { attr: 'data-player-stage' } },
        { press: { name: 'Lock Landscape', role: 'button' } },
        { shows: { name: 'Exit Fullscreen', role: 'button' } },
        { press: { name: 'Lyrics Style', role: 'button' } },
        { shows: { name: 'Lyrics Style', role: 'dialog' } },
      ],
      views: ['pwa-portrait'],
    },
    {
      // Lyrics Style with the song's own style (This Song, then a change): the panel grows the layout switches and
      // what only a song's own style shows; audited beside the shared state (owner, 2026-10-26: a 2×2 of buttons
      // there went unaudited). On the web only, as `style`: a narrow watch page's rail has no Lyrics Style once
      // feat/text-style lands; the touch sheet with a song's own style is audited on its side (style-floating-own)
      name: 'style-own',
      steps: [
        { press: { name: 'Lyrics Style', role: 'button' } },
        { shows: { name: 'Lyrics Style', role: 'dialog' } },
        { press: { name: 'This Song', role: 'radio' } },
        { press: { name: 'Karaoke Style', role: 'switch' } },
      ],
      views: ['web'],
    },
    {
      // The same on a phone on its side, where the rail floats over the video
      name: 'style-floating-own',
      steps: [
        { at: STAGE_POINT, hover: { attr: 'data-player-stage' } },
        { shows: { name: 'Lyrics Style', role: 'button' } },
        { press: { name: 'Lyrics Style', role: 'button' } },
        { shows: { name: 'Lyrics Style', role: 'dialog' } },
        { press: { name: 'This Song', role: 'radio' } },
        { press: { name: 'Karaoke Style', role: 'switch' } },
      ],
      views: ['pwa-landscape'],
    },
    {
      // Upright, the lyrics window under the video expands to fill the screen under it (a tap on its lines, or
      // Expand Lyrics in its corner), with Text Style and Minimize Lyrics in that corner
      name: 'lyrics-expanded',
      steps: [
        { press: { name: 'Expand Lyrics', role: 'button' } },
        { shows: { name: 'Minimize Lyrics', role: 'button' } },
      ],
      views: ['pwa-portrait', 'safari-portrait'],
    },
  ],
}

/** How long the player's phase and its lyric line must hold before the audit takes them as settled */
const HOLD_MS = 500

/**
 * The player out of PASSING_PHASES for HOLD_MS, read from the recorder's log of every phase change. Not a single
 * look: on its way to `starting` the player passes through `ready` for 20 to 90 ms (2026-11-11). WebKit in Playwright
 * may never play the video, so after 10 s the page is audited in whatever phase it is in; the phase is in the notes
 */
const phaseHeld = async (page: Page): Promise<void> => {
  await page
    .waitForFunction(
      ({ passing, holdMs }) => {
        const last = window.__bench.phases.at(-1)
        return (
          last !== undefined &&
          !passing.includes(last.phase) &&
          performance.now() - last.t >= holdMs
        )
      },
      { holdMs: HOLD_MS, passing: PASSING_PHASES },
      { polling: 50, timeout: 10_000 }
    )
    .catch(() => {
      // A player stuck loading or starting is audited as it is
    })
}

/** In the page: whether the line lineHeld waits for is drawn, and what was found */
const currentLine = () => {
  const stage = document.querySelector<HTMLElement>('[data-player-stage]')
  if (stage === null) {
    return { drawn: false, layer: false, lines: 0, phase: 'none' }
  }
  const layer = stage.querySelector('[data-lyric-layer]')
  const found = [
    ...(layer === null
      ? document.querySelectorAll(
          '[data-bench=lyrics-text][data-phase=current]'
        )
      : layer.querySelectorAll('[data-bench=lyrics-line]')),
  ]
  const drawn = found.some((el) => {
    const r = el.getBoundingClientRect()
    return (
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.top < window.innerHeight &&
      (el.textContent ?? '').trim() !== ''
    )
  })
  return {
    drawn,
    layer: layer !== null,
    lines: found.length,
    phase: stage.dataset.phase ?? 'none',
  }
}

/**
 * A lyric line drawn where the player shows the current one, with text, on screen, for HOLD_MS: the stage's lyrics
 * layer, or on a narrow watch page (no lyrics over the video) the lyrics panel's current line. Not the recorder's
 * `lyrics-line` mark: that fires on any line, and the lyrics panel draws the whole song about 0.6 s after navigation,
 * before the stage has a line (web and an upright phone, 2026-11-11). Held, because the line drops for about 200 ms as
 * playback begins (the time reads the link's start, then 0, then the start again)
 */
const lineHeld = async (page: Page): Promise<void> => {
  const timeoutMs = 30_000
  const start = Date.now()
  let since: number | null = null
  // Looked at from here every 50 ms, so the page keeps no state for the wait
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one look per poll
    const seen = await page.evaluate(currentLine)
    const now = Date.now()
    since = seen.drawn ? (since ?? now) : null
    if (since !== null && now - since >= HOLD_MS) {
      return
    }
    if (now - start > timeoutMs) {
      throw new Error(
        `no lyric line drawn for ${HOLD_MS}ms within ${timeoutMs / 1000}s (${seen.layer ? 'stage lyrics' : 'lyrics panel'}: ${seen.lines} lines, none on screen with text; player ${seen.phase})`
      )
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- the next look
    await page.waitForTimeout(50)
  }
}

const scriptName = (url: string) =>
  new URL(url).pathname.split('/').at(-1) ?? url

/**
 * The player's YouTube iframe (mark `player-iframe`). It needs only the iframe API's scripts from youtube.com, so a
 * wait that runs out says which of them were still unanswered and which failed (the bench's relay names its reason,
 * engines/browser.ts › RELAY_ERROR): the network's wait, not the page's. The app doesn't load a failed script again
 */
const iframeMark = async (page: Page): Promise<void> => {
  const pending = new Map<string, number>()
  const failed = new Map<string, string>()
  const started = (r: Request) => {
    if (YOUTUBE_IFRAME_API.test(r.url())) {
      pending.set(r.url(), Date.now())
    }
  }
  const finished = async (r: Request) => {
    if (pending.delete(r.url())) {
      const response = await r.response()
      if (response !== null && !response.ok()) {
        const reason = await response.headerValue(RELAY_ERROR)
        failed.set(
          scriptName(r.url()),
          `${response.status()}${reason === null ? '' : `, ${reason}`}`
        )
      }
    }
  }
  const errored = (r: Request) => {
    if (pending.delete(r.url())) {
      failed.set(scriptName(r.url()), r.failure()?.errorText ?? 'failed')
    }
  }
  page.on('request', started)
  page.on('requestfinished', finished)
  page.on('requestfailed', errored)
  try {
    await mark(page, 'player-iframe', 30_000)
  } catch (error) {
    const waits = [...pending].map(
      ([url, at]) =>
        `${scriptName(url)} for ${((Date.now() - at) / 1000).toFixed(0)}s`
    )
    const failures = [...failed].map(([script, why]) => `${script} (${why})`)
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; YouTube API scripts unanswered: ${waits.join(', ') || 'none'}; failed: ${failures.join(', ') || 'none'}`,
      { cause: error }
    )
  } finally {
    page.off('request', started)
    page.off('requestfinished', finished)
    page.off('requestfailed', errored)
  }
}

/**
 * The player built and settled, with or without a lyric line: its YouTube iframe, then its phase held. The player
 * page's `ready` waits for a line on top of this; a probe that needs no line (and would see the karaoke fill move
 * every frame once one shows) waits for this alone
 */
export const playerUp = async (
  page: Page,
  note?: (wait: string) => void
): Promise<void> => {
  note?.('the YouTube iframe (mark player-iframe)')
  await iframeMark(page)
  note?.(`the player out of loading, starting and buffering for ${HOLD_MS}ms`)
  await phaseHeld(page)
}

/**
 * In the page: the player's controls shown and at rest, '' when they are; else what is not. Shown: the control bar
 * has no `data-controls-hidden`. At rest: no animation or transition runs on anything in the stage or the rail
 * (`[data-player-chrome]`): the controls fade and the rails slide in for 300 ms, and a capture in between finds
 * them half way (2026-11-12)
 */
export const controlsAtRest = (): string => {
  const stage = document.querySelector('[data-player-stage]')
  if (stage === null) {
    return 'no player stage'
  }
  if (stage.querySelector('[data-controls-hidden]') !== null) {
    return 'the controls are hidden'
  }
  const moving = document.getAnimations().filter((a) => {
    const target = a.effect instanceof KeyframeEffect ? a.effect.target : null
    return (
      a.playState === 'running' &&
      target instanceof Element &&
      (stage.contains(target) ||
        target.closest('[data-player-chrome]') !== null)
    )
  })
  return moving.length === 0
    ? ''
    : `${moving.length} animations still running on the controls`
}

/**
 * The player's controls brought up by a finger's tap at (x, y) on the screen, and settled. A tap toggles them, so
 * one that lands while they still show hides them: first wait for them to go (1.8 s after the last input on a touch
 * screen; the player page's `ready` ends with the pointer on the stage, which shows them). Ones still up after 5 s
 * are held (a paused player) and get no tap. Then wait until they are shown and at rest (`controlsAtRest`): the tap
 * shows them only once the double-tap window (280 ms) has passed, and they slide in over 300 ms more, so a fixed
 * wait after the tap caught them half way on a loaded machine. They hide again 1.8 s after the tap: capture at once
 */
export const tapControlsUp = async (
  page: Page,
  at: { x: number; y: number }
): Promise<void> => {
  const hidden = await page
    .waitForFunction(
      () =>
        document.querySelector('[data-player-stage] [data-controls-hidden]') !==
        null,
      null,
      { polling: 100, timeout: 5000 }
    )
    .then(
      () => true,
      () => false
    )
  if (hidden) {
    await page.touchscreen.tap(at.x, at.y)
  }
  const deadline = Date.now() + 5000
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one look per poll
    const why = await page.evaluate(controlsAtRest)
    if (why === '') {
      return
    }
    if (Date.now() > deadline) {
      throw new Error(`the controls never came up at rest: ${why}`)
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- the next look
    await page.waitForTimeout(50)
  }
}

/**
 * For a page without the bench's recorder (`openPlainChromium`): the player's stage built and its phase out of
 * PASSING_PHASES for HOLD_MS, polled from here. Returns the phase it settled in, 'none' when the page has no player
 * stage after `timeoutMs` (a /v/ page for a video outside the library has none), or the phase it was stuck in
 */
export const playerSettled = async (
  page: Page,
  timeoutMs: number
): Promise<{ settled: boolean; phase: string }> => {
  const start = Date.now()
  let since: number | null = null
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one look per poll
    const phase = await page.evaluate(
      () =>
        document.querySelector<HTMLElement>('[data-player-stage]')?.dataset
          .phase ?? 'none'
    )
    const now = Date.now()
    since =
      phase !== 'none' && !PASSING_PHASES.includes(phase)
        ? (since ?? now)
        : null
    if (since !== null && now - since >= HOLD_MS) {
      return { phase, settled: true }
    }
    if (now - start > timeoutMs) {
      return { phase, settled: false }
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- the next look
    await page.waitForTimeout(50)
  }
}

/** The pointer onto the stage's corner, which brings the controls back */
export const pointerOnStage = async (page: Page): Promise<void> => {
  await page
    .locator('[data-player-stage]')
    .hover({ force: true, position: { x: 40, y: 40 } })
    .catch(() => {
      // The hover only brings the controls back; audit the page either way
    })
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
    // The field's states are Home's, opened from the top of the page
    states: [],
  },
  {
    name: 'player',
    path: `/v/${PLAYER_SONG}?t=${PLAYER_AUDIT_SEC}`,
    ready: async (page, note) => {
      await playerUp(page, note)
      note?.(`a lyric line drawn for ${HOLD_MS}ms`)
      await lineHeld(page)
      note?.('the pointer onto the stage')
      await pointerOnStage(page)
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
  'staggeredActions',
  'iconOffText',
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

/**
 * Buttons in an open dialog, menu or popover that don't line up (owner, 2026-10-26: Lyrics Style's Reset Positions
 * and Save Current Style sat staggered on two rows): two side by side whose centre lines differ by more than 1px,
 * and two rows next to each other that share neither a leading nor a trailing edge and overlap across by less than
 * half the narrower (one at the start of a row, the other at the end of the next: a staggered pair, not a layout).
 * Runs in the page; the page's own axes on a page turned by Lock Landscape
 */
const staggeredActions = (): string[] => {
  const turned = Object.hasOwn(
    document.documentElement.dataset,
    'landscapeLock'
  )
  const box = (e: Element) => {
    const r = e.getBoundingClientRect()
    return turned
      ? { cy: r.left + r.width / 2, h: r.width, x0: r.top, x1: r.bottom }
      : { cy: r.top + r.height / 2, h: r.height, x0: r.left, x1: r.right }
  }
  const found: string[] = []
  const PANEL =
    '[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]'
  // A popover's content is a dialog inside its wrapper: each panel once, the outermost
  const panels = [...document.querySelectorAll(PANEL)].filter(
    (p) => (p.parentElement?.closest(PANEL) ?? null) === null
  )
  for (const panel of panels) {
    const buttons = [...panel.querySelectorAll('button')]
      .filter((b) => {
        const r = b.getBoundingClientRect()
        return (
          r.width >= 1 &&
          r.height >= 1 &&
          b.closest('[role="radiogroup"]') === null
        )
      })
      .map((b) => ({
        label: (b.getAttribute('aria-label') ?? b.textContent ?? '')
          .trim()
          .slice(0, 30),
        ...box(b),
      }))
    // Rows: buttons whose middles fall within half the first one's height of each other
    const rows: (typeof buttons)[] = []
    for (const b of buttons.toSorted((a, z) => a.cy - z.cy)) {
      const row = rows.find((r) => Math.abs(r[0].cy - b.cy) < r[0].h / 2)
      if (row) {
        row.push(b)
      } else {
        rows.push([b])
      }
    }
    for (const row of rows) {
      const spread =
        Math.max(...row.map((b) => b.cy)) - Math.min(...row.map((b) => b.cy))
      if (row.length > 1 && spread > 1) {
        found.push(
          `side by side ${Math.round(spread * 10) / 10}px off one centre line: ${row.map((b) => b.label).join(' | ')}`
        )
      }
    }
    for (let i = 1; i < rows.length; i += 1) {
      const [upper, lower] = [rows[i - 1], rows[i]]
      const gap = lower[0].cy - lower[0].h / 2 - (upper[0].cy + upper[0].h / 2)
      const start = (r: typeof buttons) => Math.min(...r.map((b) => b.x0))
      const end = (r: typeof buttons) => Math.max(...r.map((b) => b.x1))
      const sharesEdge =
        Math.abs(start(upper) - start(lower)) <= 1 ||
        Math.abs(end(upper) - end(lower)) <= 1
      // Rows that mostly lie across each other (a full-width button over a switch row) are stacked, not staggered
      const overlap =
        Math.min(end(upper), end(lower)) - Math.max(start(upper), start(lower))
      const narrower = Math.min(
        end(upper) - start(upper),
        end(lower) - start(lower)
      )
      if (gap < 24 && !sharesEdge && overlap < narrower / 2) {
        found.push(
          `staggered rows: ${upper.map((b) => b.label).join(' | ')} / ${lower.map((b) => b.label).join(' | ')}`
        )
      }
    }
  }
  return found
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

/** In the page: what is drawn at `at` from the element's top-left corner, when it is not the element ('' when it is) */
const coveredAt = (el: Element, at: { x: number; y: number }): string => {
  const r = el.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + at.x, r.top + at.y)
  if (hit === null) {
    return 'nothing (off screen)'
  }
  if (el.contains(hit)) {
    return ''
  }
  const label = hit.getAttribute('aria-label')
  return `<${hit.tagName.toLowerCase()}${label === null ? '' : ` "${label}"`}>`
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
        await (step.paste === true
          ? page.keyboard.insertText(step.type)
          : page.keyboard.type(step.type))
      } else if ('shows' in step) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- steps run in order
        await onScreen(page, step.shows)
      } else if ('hover' in step) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- steps run in order
        const l = await onScreen(page, step.hover)
        if (step.at !== undefined) {
          // A point covered by something else moves the pointer onto that instead, and the step does nothing it says.
          // Polled: during a view transition (Theater Mode) the page's root covers everything
          const deadline = Date.now() + STEP_TIMEOUT_MS
          for (;;) {
            // oxlint-disable-next-line eslint/no-await-in-loop -- polled until the point is clear
            const covered = await l.evaluate(coveredAt, step.at)
            if (covered === '') {
              break
            }
            if (Date.now() > deadline) {
              throw new Error(
                `the point (${step.at.x}, ${step.at.y}) is covered by ${covered}`
              )
            }
            // oxlint-disable-next-line eslint/no-await-in-loop -- the next look
            await page.waitForTimeout(100)
          }
        }
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
    if (state?.signedIn === true) {
      await signIn(page)
    }
    if (state?.generating === true) {
      await holdGeneration(page)
    }
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
    // a pane from nowhere (owner, 2026-10-26, and on a turned page 2026-10-25). A popover that names an anchor
    // (data-menu-anchor) is measured against that instead
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
          // A popover that opens beside what it changes rather than its button names that element
          // (data-menu-anchor, an id), and is measured against it: Text Style beside the Lyrics panel
          const anchorId =
            menu instanceof HTMLElement ? menu.dataset.menuAnchor : undefined
          const anchor =
            anchorId === undefined
              ? null
              : document.querySelector(`#${CSS.escape(anchorId)}`)
          const a =
            anchor === null ? drawn(button) : anchor.getBoundingClientRect()
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
    at.step = 'checking open panels for staggered buttons'
    const staggered = await page.evaluate(staggeredActions)
    at.step = 'measuring icons against their labels'
    const iconOff = await page.evaluate(iconTextOffsets, ICON_ALIGN_LIMIT_PX)
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
      ...staggered.map((s) => `buttons out of line: ${s}`),
      ...iconOff.map(
        (o) =>
          `icon ${Math.abs(o.offsetPx)}px ${o.offsetPx > 0 ? 'below' : 'above'} its label's ink centre at ${o.rect.x},${o.rect.y} ${o.rect.w}×${o.rect.h}: ${o.label}`
      ),
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
            iconOffText: iconOff.length,
            insetSurfaces: audit.insetSurfaces.length,
            occludedTargets: audit.occluded.length,
            offscreenTargets: audit.offscreen.length,
            overflowXPx: audit.overflowX,
            pageErrors,
            panXPx: audit.pan.px,
            smallTargets: audit.small.length,
            smoothScrollReduced: smooth.length,
            staggeredActions: staggered.length,
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

/**
 * The limit for an audit starting now: longer on a busy machine (1-minute load over the cores, up to twice), where
 * every wait runs slower and a slow audit is not a stuck one. Capped, so a real hang still ends within 90 s
 */
const auditLimitMs = (): number =>
  Math.round(
    AUDIT_LIMIT_MS *
      Math.min(2, Math.max(1, os.loadavg()[0] / os.availableParallelism()))
  )

/** One page at one URL on one screen, its screenshot saved to `shot` */
export const auditPage = async (
  p: LayoutPage,
  surface: Surface,
  url: string,
  shot: string,
  state?: OpenedState
): Promise<{ samples: Sample[]; errors: string[] }> => {
  const at = { step: 'opening the page' }
  const limit = auditLimitMs()
  let timer: ReturnType<typeof setTimeout> | undefined
  // oxlint-disable-next-line promise/avoid-new -- settles when the limit passes
  const stuck = new Promise<{ samples: Sample[]; errors: string[] }>(
    (resolve) => {
      timer = setTimeout(() => {
        resolve({
          errors: [`audit stuck for ${limit / 1000}s while ${at.step}`],
          samples: [],
        })
      }, limit)
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
