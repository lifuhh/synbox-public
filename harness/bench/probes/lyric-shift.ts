// Two Lines (Karaoke Style) on a phone on its side: what moves when a line changes. The owner's rule (2026-10-25):
// a line change moves as little as it can. The docked translation's place never moves, the lower line's romaji never
// moves, and a line whose text stays put never moves for the other line's change. Played for a bounded window and
// sampled in the page; the counts gate in `check` (budget 0), and a run that saw no line change is no sample.

import path from 'node:path'

import type { Page } from 'playwright'

import { open } from '../engines/browser'
import type { BenchContext, Sample, Surface } from '../types'
import { LAYOUT_PAGES, PLAYER_SONG } from './layout'

/** How long the song plays under watch: about four line changes in this song */
const WATCH_MS = 22_000
const SAMPLE_MS = 80
/** Past this a move is a move; below it, subpixel rounding */
const MOVED_PX = 1
/** The whole run's limit, the player's own readiness included */
const LIMIT_MS = 75_000

interface ShiftTally {
  lineChanges: number
  otherLineMoves: number
  lowerRomajiMoves: number
  dockedTranslationMoves: number
  notes: string[]
}

/** Two Lines on, the translation shown and docked under the rows: the layout the owner's rule is about */
const KARAOKE_PREFS = {
  lyricsShowTranslation: 'true',
  lyricsTranslationDocked: 'true',
  lyricsTwoLines: JSON.stringify({ default: true, theater: true }),
}

const turnPage = async (page: Page) => {
  for (const name of ['Fullscreen', 'Lock Landscape']) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one press, then the next
    const pressed = await page.evaluate((label) => {
      const button = document.querySelector<HTMLButtonElement>(
        `button[aria-label="${label}"]`
      )
      button?.click()
      return button !== null
    }, name)
    if (!pressed) {
      throw new Error(`no "${name}" button to turn the page`)
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- the stage settles before the next press
    await page.waitForTimeout(1000)
  }
  const turned = await page.evaluate(() =>
    Object.hasOwn(document.documentElement.dataset, 'landscapeLock')
  )
  if (!turned) {
    throw new Error('Lock Landscape did not turn the page')
  }
}

/**
 * Two Lines' rows on the stage. Turning the page remounts the player, which starts over in the song's intro (about
 * 14 s here, no lines shown): the player's own shortcut skips ahead 5 s a press until the rows show
 */
const twoLines = async (page: Page) => {
  const shown = async () =>
    await page
      .waitForFunction(
        () => document.querySelectorAll('[data-lyric-row]').length === 2,
        undefined,
        { polling: 100, timeout: 1000 }
      )
      .then(
        () => true,
        () => false
      )
  for (let skips = 0; skips < 5; skips += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one look, then a press
    if (await shown()) {
      return
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- one press at a time
    await page.keyboard.press('ArrowRight')
  }
}

/** Samples in the page itself, on a timer, so a sample costs no round trip; each box in the page's axes */
const watch = async (page: Page): Promise<ShiftTally> =>
  await page.evaluate(
    async ({ watchMs, sampleMs, movedPx }) => {
      interface Box {
        top: number
        bottom: number
      }
      interface Snap {
        rows: { key: string; parts: Box[]; texts: string[] }[]
        translation: Box | null
      }
      const turned =
        Object.hasOwn(document.documentElement.dataset, 'landscapeLock') &&
        matchMedia('(orientation: portrait)').matches
      const flipped = Object.hasOwn(
        document.documentElement.dataset,
        'landscapeFlip'
      )
      const box = (e: Element): Box => {
        const r = e.getBoundingClientRect()
        if (!turned) {
          return { bottom: r.bottom, top: r.top }
        }
        // Turned clockwise the page's top is the screen's right edge; flipped, its left edge
        return flipped
          ? { bottom: r.right, top: r.left }
          : { bottom: innerWidth - r.left, top: innerWidth - r.right }
      }
      const snap = (): Snap | null => {
        const rows = [...document.querySelectorAll('[data-lyric-row]')]
        if (rows.length !== 2) {
          return null
        }
        const t = document.querySelector(
          '[data-docked-translation="docked"] > div > div'
        )
        return {
          rows: rows.map((row) => {
            const parts = [...row.children].filter(
              (e) =>
                e instanceof HTMLElement &&
                e.offsetHeight > 0 &&
                !e.hasAttribute('aria-hidden')
            )
            const texts = parts.map((e) =>
              (e.textContent ?? '').trim().slice(0, 12)
            )
            return { key: texts.join('|'), parts: parts.map(box), texts }
          }),
          translation: t === null ? null : box(t),
        }
      }
      const tally = {
        dockedTranslationMoves: 0,
        lineChanges: 0,
        lowerRomajiMoves: 0,
        notes: [] as string[],
        otherLineMoves: 0,
      }
      const NAMES = ['upper (left)', 'lower (right)']
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page: nothing outside this function is there
      const px = (a: number, b: number) => Math.round(Math.abs(a - b))
      // A line change in one row: every row of the other line must hold its place
      const otherLine = (now: Snap, before: Snap) => {
        const changed = now.rows.map((r, i) => r.key !== before.rows[i].key)
        if (changed.filter(Boolean).length !== 1) {
          return
        }
        tally.lineChanges += 1
        const other = changed[0] ? 1 : 0
        const mine = 1 - other
        for (const [i, part] of now.rows[other].parts.entries()) {
          if (i >= before.rows[other].parts.length) {
            continue
          }
          const was = before.rows[other].parts[i]
          if (
            px(part.top, was.top) > movedPx ||
            px(part.bottom, was.bottom) > movedPx
          ) {
            tally.otherLineMoves += 1
            tally.notes.push(
              `${NAMES[other]} line's row ${i + 1} ("${now.rows[other].texts[i]}") moved ${px(part.top, was.top)}px when the ${NAMES[mine]} line changed to "${now.rows[mine].texts[0] ?? ''}"`
            )
          }
        }
      }
      // The lower line's romaji stands on the floor, whatever the lines say
      const lowerRomaji = (now: Snap, before: Snap) => {
        const lower = now.rows[1].parts.at(-1)
        const was = before.rows[1].parts.at(-1)
        if (
          lower === undefined ||
          was === undefined ||
          now.rows[1].parts.length < 2 ||
          before.rows[1].parts.length < 2 ||
          px(lower.bottom, was.bottom) <= movedPx
        ) {
          return
        }
        tally.lowerRomajiMoves += 1
        tally.notes.push(
          `lower (right) line's romaji ("${now.rows[1].texts.at(-1) ?? ''}") moved ${px(lower.bottom, was.bottom)}px`
        )
      }
      const translation = (now: Snap, before: Snap) => {
        if (
          now.translation === null ||
          before.translation === null ||
          px(now.translation.top, before.translation.top) <= movedPx
        ) {
          return
        }
        tally.dockedTranslationMoves += 1
        tally.notes.push(
          `docked translation moved ${px(now.translation.top, before.translation.top)}px`
        )
      }
      let prev = snap()
      const started = performance.now()
      // oxlint-disable-next-line promise/avoid-new -- the sampler runs on a timer until the window ends
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          const now = snap()
          if (now && prev) {
            otherLine(now, prev)
            lowerRomaji(now, prev)
            translation(now, prev)
          }
          if (now) {
            prev = now
          }
          if (performance.now() - started > watchMs) {
            clearInterval(timer)
            resolve()
          }
        }, sampleMs)
      })
      return tally
    },
    { movedPx: MOVED_PX, sampleMs: SAMPLE_MS, watchMs: WATCH_MS }
  )

const shiftOnce = async (
  surface: Surface,
  turned: boolean,
  url: string,
  shot: string
): Promise<{ samples: Sample[]; errors: string[] }> => {
  const player = LAYOUT_PAGES.find((p) => p.name === 'player')
  if (player === undefined) {
    throw new Error('no player page in LAYOUT_PAGES')
  }
  const { page, close, context } = await open(surface)
  try {
    await context.addInitScript((prefs) => {
      for (const [key, value] of Object.entries(prefs)) {
        localStorage.setItem(key, value)
      }
    }, KARAOKE_PREFS)
    await page.goto(url, { waitUntil: 'commit' })
    await player.ready(page)
    if (turned) {
      await turnPage(page)
    }
    await twoLines(page)
    const rows = await page.locator('[data-lyric-row]').count()
    if (rows !== 2) {
      throw new Error(`Two Lines didn't show: ${rows} lyric rows on the stage`)
    }
    const docked = await page
      .locator('[data-docked-translation="docked"]')
      .count()
    if (docked !== 1) {
      throw new Error('the docked translation never showed')
    }
    const tally = await watch(page)
    await page.screenshot({ path: shot })
    if (tally.lineChanges === 0) {
      throw new Error(
        `no line changed in ${WATCH_MS / 1000}s of playback (player phase: ${await page.evaluate(() => document.querySelector<HTMLElement>('[data-player-stage]')?.dataset.phase ?? 'none')}): nothing was measured`
      )
    }
    return {
      errors: [],
      samples: [
        {
          notes: tally.notes,
          values: {
            dockedTranslationMoves: tally.dockedTranslationMoves,
            lineChanges: tally.lineChanges,
            lowerRomajiMoves: tally.lowerRomajiMoves,
            otherLineMoves: tally.otherLineMoves,
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

/** Two Lines' moves on the player in one view; `turned`: an upright phone turned by Lock Landscape */
export const lyricShiftAudit =
  (surface: Surface, turned: boolean) =>
  async (
    ctx: BenchContext
  ): Promise<{ samples: Sample[]; errors: string[] }> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    // oxlint-disable-next-line promise/avoid-new -- settles when the limit passes
    const stuck = new Promise<{ samples: Sample[]; errors: string[] }>(
      (resolve) => {
        timer = setTimeout(() => {
          resolve({
            errors: [`lyric shift audit stuck for ${LIMIT_MS / 1000}s`],
            samples: [],
          })
        }, LIMIT_MS)
      }
    )
    try {
      return await Promise.race([
        shiftOnce(
          surface,
          turned,
          `${ctx.origin}/v/${PLAYER_SONG}`,
          path.join(ctx.artifactDir, 'screen.png')
        ),
        stuck,
      ])
    } finally {
      clearTimeout(timer)
    }
  }
