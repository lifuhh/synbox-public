// The app with a keyboard alone (owner, 2026-10-27: Synbox should work on a TV, where a remote's D-pad and OK are
// arrow keys and Enter). One journey, Tab / Enter / Escape only: Home → a song → Play/Pause → Lyrics Style → a colour →
// close it (focus back on its button) → the top bar's search → a result → its song. Every element Tab lands on must
// show where focus is: an outline, a ring (box-shadow) or a border that its unfocused self doesn't have, on itself, a
// child (a swatch draws its ring on the tile inside) or its text field's frame, and not cut off by a row that clips
// its overflow. A step whose target Tab never reaches, focus falling to the page's body after an action, and a focused
// element with no visible indicator are each a finding.

import { chromium } from 'playwright'
import type { Page } from 'playwright'

import { isRecord } from '../json'
import type { BenchContext, Sample } from '../types'
import { PLAYER_SONG } from './layout'

const LIMIT_MS = 150_000
/** Tab presses allowed to reach one step's target */
const MAX_TABS = 90
const QUERY = 'love'
/** Longest transition that focus starts (the volume slider widening) */
const REVEAL_MS = 250

type Indicator = 'strong' | 'weak' | 'none'

interface Focused {
  /** Tag plus accessible name, for the notes */
  label: string
  href: string | null
  role: string | null
  name: string
  body: boolean
  /** 'strong': outline, ring or border appear; 'weak': only the background changes; 'none': nothing */
  indicator: Indicator
}

/**
 * Runs in the page (plain JS, evaluated as a string). `__snapshot` stores the unfocused look of every focusable
 * element before Tab reaches it: blurring the focused element to compare would move Tab's starting point.
 * `__readFocus` describes the focused element and whether focus changed how it, a child or its field's frame is
 * drawn, or whether its indicator is cut by an ancestor that clips its overflow
 */
const IN_PAGE = `(() => {
  if (window.__readFocus) return
  const look = (node) => {
    const s = getComputedStyle(node)
    return {
      bg: s.backgroundColor,
      border: s.borderTopColor + ' ' + s.borderTopWidth,
      outline: s.outlineStyle === 'none' || s.outlineWidth === '0px' ? 'none' : s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor,
      shadow: s.boxShadow,
    }
  }
  const parts = (node) => [node.closest('[data-focus-field]') ?? node, node, ...Array.from(node.querySelectorAll('*')).slice(0, 12)]
  const looks = new WeakMap()
  const FOCUSABLE = 'a[href], button, input, select, textarea, iframe, [tabindex]:not([tabindex="-1"]), [role="radio"], [role="tab"], [role="slider"], summary'
  window.__snapshot = () => {
    for (const el of document.querySelectorAll(FOCUSABLE)) {
      if (el !== document.activeElement && !looks.has(el)) looks.set(el, parts(el).map(look))
    }
  }
  window.__readFocus = () => {
    const el = document.activeElement
    if (el === null || el === document.body || el === document.documentElement) {
      return { body: true, href: null, indicator: 'none', label: 'body', name: '', role: null }
    }
    const name = (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.textContent ?? '').trim().replace(/\\s+/gu, ' ').slice(0, 40)
    const base = { body: false, href: el.getAttribute('href'), name, role: el.getAttribute('role') }
    const label = el.tagName.toLowerCase() + (name === '' ? '' : ' "' + name + '"')
    const drawn = el.closest('[data-focus-field]') ?? el
    const ds = getComputedStyle(drawn)
    const spreads = [...ds.boxShadow.matchAll(/0px 0px 0px (?<spread>[\\d.]+)px/gu)].map((m) => Number(m.groups.spread))
    const reach = ds.outlineStyle === 'none'
      ? Math.max(0, ...spreads)
      : Math.max(0, Number.parseFloat(ds.outlineOffset) + Number.parseFloat(ds.outlineWidth))
    if (reach > 0) {
      const box = drawn.getBoundingClientRect()
      for (let a = drawn.parentElement; a !== null && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a)
        if (/hidden|clip|auto|scroll/u.test(s.overflowX + ' ' + s.overflowY)) {
          const c = a.getBoundingClientRect()
          if (box.left - reach < c.left - 0.5 || box.top - reach < c.top - 0.5 || box.right + reach > c.right + 0.5 || box.bottom + reach > c.bottom + 0.5) {
            return { ...base, indicator: 'none', label: label + ' (indicator clipped)' }
          }
        }
      }
    }
    const now = parts(el).map(look)
    const before = looks.get(el)
    if (el.tagName === 'IFRAME' || before === undefined) {
      const f = now[0]
      return { ...base, indicator: f.outline !== 'none' || /0px 0px 0px [1-9]/u.test(f.shadow) ? 'strong' : 'none', label }
    }
    let indicator = 'none'
    for (const [i, f] of now.entries()) {
      const r = before[i]
      if (r === undefined) continue
      if (f.outline !== r.outline || f.shadow !== r.shadow || f.border !== r.border) indicator = 'strong'
      else if (indicator === 'none' && f.bg !== r.bg) indicator = 'weak'
    }
    return { ...base, indicator, label }
  }
})()`

const INDICATORS = new Set<string>(['strong', 'weak', 'none'])

const textOrNull = (value: unknown) =>
  typeof value === 'string' ? value : null

const toFocused = (value: unknown): Focused => {
  if (!isRecord(value)) {
    throw new Error('keyboard probe: no focus reading from the page')
  }
  const indicator = INDICATORS.has(String(value.indicator))
    ? String(value.indicator)
    : 'none'
  return {
    body: value.body === true,
    href: textOrNull(value.href),
    indicator:
      indicator === 'strong' || indicator === 'weak' ? indicator : 'none',
    label: String(value.label),
    name: String(value.name),
    role: textOrNull(value.role),
  }
}

const readFocus = async (page: Page): Promise<Focused> =>
  toFocused(await page.evaluate(`${IN_PAGE}; window.__readFocus()`))

const snapshot = async (page: Page) => {
  await page.evaluate(`${IN_PAGE}; window.__snapshot()`)
}

interface Journey {
  steps: { step: string; reached: boolean; tabs: number }[]
  invisible: Set<string>
  weak: Set<string>
  lost: string[]
}

/** Tab until `want` is focused; every element passed is checked for a visible indicator */
const tabTo = async (
  page: Page,
  j: Journey,
  step: string,
  want: (f: Focused) => boolean,
  key: 'Tab' | 'Shift+Tab' = 'Tab'
): Promise<Focused | null> => {
  for (let tabs = 1; tabs <= MAX_TABS; tabs += 1) {
    // oxlint-disable-next-line no-await-in-loop -- the unfocused looks of whatever just appeared, before the key
    await snapshot(page)
    // oxlint-disable-next-line no-await-in-loop -- one key press at a time
    await page.keyboard.press(key)
    // oxlint-disable-next-line no-await-in-loop -- what focus reveals (the volume slider) opens over 200ms
    await page.waitForTimeout(REVEAL_MS)
    // oxlint-disable-next-line no-await-in-loop -- read after each press
    const f = await readFocus(page)
    if (!f.body) {
      if (f.indicator === 'none') {
        j.invisible.add(f.label)
      } else if (f.indicator === 'weak') {
        j.weak.add(f.label)
      }
    }
    if (want(f)) {
      j.steps.push({ reached: true, step, tabs })
      return f
    }
  }
  j.steps.push({ reached: false, step, tabs: MAX_TABS })
  return null
}

const afterAction = async (page: Page, j: Journey, action: string) => {
  const f = await readFocus(page)
  if (f.body) {
    j.lost.push(action)
  }
}

const SONG_HREF = /\/v\/[\w-]{11}/u
const isSong = (f: Focused) => f.href !== null && SONG_HREF.test(f.href)
const PLAY = /^(?<action>Play|Pause)$/iu
const SWATCH = /^(?<theme>Cinema|Amethyst|Sunset|Matcha|Lemon|Sakura)/u

export const journey = async (origin: string): Promise<Journey> => {
  const j: Journey = {
    invisible: new Set(),
    lost: [],
    steps: [],
    weak: new Set(),
  }
  // Playwright's own Chromium, not the bench's Google Chrome: on macOS, Chrome follows the system's Keyboard
  // Navigation setting, which by default makes Tab skip buttons and links (Option-Tab reaches them). A TV's D-pad
  // and a keyboard user with that setting on reach everything, so the journey runs without it
  const browser = await chromium.launch({ args: ['--mute-audio'] })
  const page = await browser.newPage({
    viewport: { height: 1080, width: 1920 },
  })
  await page.route(/sentry\.io/u, async (route) => {
    await route.abort()
  })
  try {
    await page.goto(`${origin}/`, { waitUntil: 'load' })
    await page.locator('a[href^="/v/"]').first().waitFor({ timeout: 20_000 })
    if (await tabTo(page, j, 'home: a song', isSong)) {
      await page.keyboard.press('Enter')
      await page.waitForURL(/\/v\//u, { timeout: 15_000 })
    } else {
      await page.goto(`${origin}/v/${PLAYER_SONG}`, {
        waitUntil: 'domcontentloaded',
      })
    }
    await page.waitForTimeout(2500)
    if (await tabTo(page, j, 'song: Play/Pause', (f) => PLAY.test(f.name))) {
      await page.keyboard.press('Enter')
      await page.waitForTimeout(400)
      await afterAction(page, j, 'Play/Pause')
    }
    if (
      await tabTo(page, j, 'song: Lyrics Style', (f) =>
        /lyrics style/iu.test(f.name)
      )
    ) {
      await page.keyboard.press('Enter')
      await page.waitForTimeout(500)
      if (
        await tabTo(page, j, 'Lyrics Style: a colour', (f) =>
          SWATCH.test(f.name)
        )
      ) {
        await page.keyboard.press('Enter')
        await page.waitForTimeout(300)
        await afterAction(page, j, 'pick a colour')
      }
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      const back = await readFocus(page)
      j.steps.push({
        reached: /lyrics style/iu.test(back.name),
        step: 'Escape: focus back on Lyrics Style',
        tabs: 0,
      })
    }
    // Back up to the top bar, which comes before the page's content
    const search = await tabTo(
      page,
      j,
      'top bar: Search',
      (f) =>
        /search/iu.test(f.name) &&
        f.role !== 'button' &&
        f.label.startsWith('input'),
      'Shift+Tab'
    )
    if (search) {
      await page.keyboard.type(QUERY)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(3000)
      if (await tabTo(page, j, 'search: a result', isSong)) {
        await page.keyboard.press('Enter')
        const opened = await page
          .waitForURL(/\/v\//u, { timeout: 15_000 })
          .then(() => true)
          .catch(() => false)
        j.steps.push({
          reached: opened,
          step: 'search: the result opens',
          tabs: 0,
        })
      }
    }
  } finally {
    await browser.close()
  }
  return j
}

export const keyboardAudit =
  () =>
  async (
    ctx: BenchContext
  ): Promise<{ samples: Sample[]; errors: string[] }> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    // oxlint-disable-next-line promise/avoid-new -- settles when the limit passes
    const stuck = new Promise<{ samples: Sample[]; errors: string[] }>(
      (resolve) => {
        timer = setTimeout(() => {
          resolve({
            errors: [`keyboard journey stuck for ${LIMIT_MS / 1000}s`],
            samples: [],
          })
        }, LIMIT_MS)
      }
    )
    const run = async () => {
      const j = await journey(ctx.origin)
      const missed = j.steps.filter((s) => !s.reached)
      return {
        errors: [],
        samples: [
          {
            notes: [
              ...j.steps.map(
                (s) =>
                  `${s.reached ? 'ok ' : 'MISSED'} ${s.step}${s.tabs > 0 ? ` (${s.tabs} Tab)` : ''}`
              ),
              ...[...j.invisible].map((l) => `no focus indicator: ${l}`),
              ...[...j.weak].map((l) => `background-only focus: ${l}`),
              ...j.lost.map((a) => `focus fell to the page after: ${a}`),
            ],
            values: {
              focusLost: j.lost.length,
              invisibleFocus: j.invisible.size,
              tabs: j.steps.reduce((sum, s) => sum + s.tabs, 0),
              unreachableSteps: missed.length,
              weakFocus: j.weak.size,
            },
          },
        ],
      }
    }
    try {
      return await Promise.race([
        run().catch((error: unknown) => ({
          errors: [
            (error instanceof Error ? error.message : String(error)).split(
              '\n'
            )[0],
          ],
          samples: [],
        })),
        stuck,
      ])
    } finally {
      clearTimeout(timer)
    }
  }
