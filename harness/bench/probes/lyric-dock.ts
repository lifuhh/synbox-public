// Karaoke Style's two blocks, the rows and the translation, driven by real pointer drags: never a dead end (owner,
// 2026-10-26, stuck on the live site with the rows over the translation near the foot: "this definitely needs to be
// quality controlled"). Three cases, each on a fresh page:
// - reach: the translation moved down off its home, the rows dragged up as far as they go reach the top (within the
//   translation home's top plus a little padding);
// - below: the translation saved at the foot, below the rows, then the rows dragged up: the same reach (a translation at the
//   bottom must not restrict how high the lyrics can move). Reach is the rows' drawn text,
//   not their block: the block is two of the song's tallest lines high, and its empty top once stopped at the edge
//   with the text far under it;
// - onto: the rows dragged onto the translation on its own dock them;
// - saved: a layout saved overlapped (rows and translation both at the foot, undocked) loads usable: docked, or the
//   two not overlapping.
// Each failure counts 1; the counts gate in `check` at 0. A case that couldn't run (no rows on the stage) is an
// error, no sample.

import path from 'node:path'

import type { Page } from 'playwright'

import { open } from '../engines/browser'
import type { BenchContext, Sample, Surface } from '../types'
import { LAYOUT_PAGES, PLAYER_SONG } from './layout'

/** How far under the translation home's top the rows may stop and still count as at the top */
const TOP_SLACK_PX = 32
/** How far the rows' lines may move when only the translation was dragged (a line's re-wrap, rounding) */
const KEEP_SLACK_PX = 6
const LIMIT_MS = 150_000

const ROWS = '[data-lyric-rows-area] [data-lyrics-style-toggle]'
const TRANSLATION = '[data-lyric-translation] [data-lyrics-style-toggle]'

const KARAOKE = {
  lyricsShowTranslation: 'true',
  lyricsTranslationDocked: 'false',
  lyricsTwoLines: JSON.stringify({ default: true, theater: true }),
}

interface Box {
  top: number
  bottom: number
}
interface Boxes {
  layerTop: number
  translationHome: number
  rows: Box | null
  // The rows' drawn text (their lines' glyph boxes), within the block
  rowsText: Box | null
  translation: Box | null
  docked: boolean
}

const boxes = async (page: Page): Promise<Boxes> =>
  await page.evaluate(
    ({ rowsSel, translationSel }) => {
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page: nothing outside this function is there
      const box = (e: Element | null) => {
        const r = e?.getBoundingClientRect()
        return r && r.height > 0 ? { bottom: r.bottom, top: r.top } : null
      }
      const layer = document.querySelector<HTMLElement>('[data-lyric-layer]')
      // The translation's room starts at its home's top (globals.css › lyric-stagger-translation-area)
      const room = document.querySelector('[data-lyric-translation]')
      const layerTop = layer?.getBoundingClientRect().top ?? 0
      const home = room ? room.getBoundingClientRect().top - layerTop : 0
      const range = document.createRange()
      const glyphs = [
        ...document.querySelectorAll('[data-lyric-rows-area] [data-lyric-row]'),
      ].flatMap((row) => {
        range.selectNodeContents(row)
        return [...range.getClientRects()].filter(
          (r) => r.width > 1 && r.height > 1
        )
      })
      return {
        docked:
          document.querySelector('[data-docked-translation="docked"]') !== null,
        layerTop,
        rows: box(document.querySelector(rowsSel)),
        rowsText:
          glyphs.length > 0
            ? {
                bottom: Math.max(...glyphs.map((r) => r.bottom)),
                top: Math.min(...glyphs.map((r) => r.top)),
              }
            : null,
        translation: box(document.querySelector(translationSel)),
        translationHome: home,
      }
    },
    { rowsSel: ROWS, translationSel: TRANSLATION }
  )

/** A press on drawn text the handle itself receives, then a drag by `dy` in 20 moves */
const drag = async (page: Page, selector: string, dy: number) => {
  const point = await page.evaluate((sel) => {
    const handle = document.querySelector(sel)
    if (!handle) {
      return null
    }
    for (const part of handle.querySelectorAll('span, ruby')) {
      const r = part.getBoundingClientRect()
      if (r.width >= 4 && r.height >= 4) {
        const x = r.left + Math.min(10, r.width / 2)
        const y = r.top + r.height / 2
        const hit = document.elementFromPoint(x, y)
        if (hit && handle.contains(hit)) {
          return { x, y }
        }
      }
    }
    return null
  }, selector)
  if (point === null) {
    throw new Error(`no point on ${selector} takes a press`)
  }
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  for (let step = 1; step <= 20; step += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one move a frame, as a hand drags
    await page.mouse.move(point.x, point.y + (dy * step) / 20)
    // oxlint-disable-next-line eslint/no-await-in-loop -- the frame between moves
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.waitForTimeout(600)
}

/**
 * A drag by `dy` dispatched on the handle itself, as mouse pointer events, in 20 moves. For a handle the stage's input
 * layer can sit over at the moment of the press (the translation at its home on a touch screen, under a mouse that a
 * real finger isn't), so the drag reaches the same handlers a finger's does
 */
const dispatchDrag = async (page: Page, selector: string, dy: number) => {
  const fire = async (type: string, offset: number) => {
    await page.evaluate(
      ({ sel, kind, by }) => {
        const handle = document.querySelector<HTMLElement>(sel)
        if (!handle) {
          throw new Error(`no ${sel}`)
        }
        const r = handle.getBoundingClientRect()
        // Where the press began, kept on the handle across the drag's calls
        if (kind === 'pointerdown') {
          handle.dataset.benchDragFrom = String(r.top + r.height / 2)
        }
        const from = Number(handle.dataset.benchDragFrom ?? r.top)
        handle.dispatchEvent(
          new PointerEvent(kind, {
            bubbles: true,
            buttons: kind === 'pointerup' ? 0 : 1,
            cancelable: true,
            clientX: r.left + r.width / 2,
            clientY: from + by,
            isPrimary: true,
            pointerId: 1,
            pointerType: 'mouse',
          })
        )
      },
      { by: offset, kind: type, sel: selector }
    )
  }
  await fire('pointerdown', 0)
  for (let step = 1; step <= 20; step += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one move a frame, as a hand drags
    await fire('pointermove', (dy * step) / 20)
    // oxlint-disable-next-line eslint/no-await-in-loop -- the frame between moves
    await page.waitForTimeout(16)
  }
  await fire('pointerup', dy)
  // The drop's places come to rest (the drag's end, a 200ms ease, a settle after the drop)
  await page.waitForTimeout(900)
}

/** The player with Karaoke Style's two rows on the stage, playing paused so the lines hold */
const karaokePage = async (
  surface: Surface,
  url: string,
  prefs: Record<string, string>
) => {
  const player = LAYOUT_PAGES.find((p) => p.name === 'player')
  if (player === undefined) {
    throw new Error('no player page in LAYOUT_PAGES')
  }
  const opened = await open(surface)
  await opened.context.addInitScript((stored) => {
    for (const [key, value] of Object.entries(stored)) {
      localStorage.setItem(key, value)
    }
  }, prefs)
  await opened.page.goto(url, { waitUntil: 'commit' })
  await player.ready(opened.page)
  for (let skips = 0; skips < 8; skips += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one look, then a press
    if ((await opened.page.locator('[data-lyric-row]').count()) === 2) {
      break
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- the player skips 5 s a press
    await opened.page.keyboard.press('ArrowRight')
    // oxlint-disable-next-line eslint/no-await-in-loop -- the rows settle
    await opened.page.waitForTimeout(1200)
  }
  if ((await opened.page.locator('[data-lyric-row]').count()) !== 2) {
    await opened.close()
    throw new Error("Karaoke Style's two rows never showed")
  }
  await opened.page.keyboard.press('k')
  await opened.page.waitForTimeout(800)
  return opened
}

const overlap = (a: Box | null, b: Box | null) =>
  a !== null && b !== null && a.bottom > b.top && a.top < b.bottom

/** One keep case (see dockAudit): the rows nudged up, the translation dragged to the foot; what went wrong, if any */
const keepCase = async (
  surface: Surface,
  url: string,
  kase: 'room' | 'tight'
): Promise<string[]> => {
  const found: string[] = []
  const { page, close } = await karaokePage(
    surface,
    url,
    kase === 'room' ? { ...KARAOKE, lyricsFontSizeTwoLines: '0.6' } : KARAOKE
  )
  try {
    await drag(page, ROWS, kase === 'room' ? -80 : -40)
    const nudged = await boxes(page)
    await dispatchDrag(page, TRANSLATION, 2000)
    const end = await boxes(page)
    const moved =
      nudged.rowsText && end.rowsText
        ? Math.abs(end.rowsText.top - nudged.rowsText.top)
        : Number.POSITIVE_INFINITY
    if (kase === 'room' && moved > KEEP_SLACK_PX) {
      found.push(
        `keep (room): dragging the translation to the foot moved the rows' lines ${Math.round(moved)}px (from ${Math.round(nudged.rowsText?.top ?? -1)}px to ${Math.round(end.rowsText?.top ?? -1)}px)`
      )
    }
    if (end.docked) {
      found.push(
        `keep (${kase}): the translation let go at the foot, below the rows, docked under them (the rows' lines moved ${Math.round(moved)}px)`
      )
    } else if (overlap(end.rowsText, end.translation)) {
      found.push(
        `keep (${kase}): the translation at the foot rests over the rows' lines (lines ${JSON.stringify(end.rowsText)}, translation ${JSON.stringify(end.translation)})`
      )
    }
  } finally {
    await close()
  }
  return found
}

const dockAudit = async (
  surface: Surface,
  url: string,
  shot: string
): Promise<{ samples: Sample[]; errors: string[] }> => {
  const notes: string[] = []
  const values = {
    rowsBelowCantReachTop: 0,
    rowsCantReachTop: 0,
    rowsMovedByTranslation: 0,
    rowsOntoNoDock: 0,
    savedOverlapped: 0,
  }
  // The rows' drawn text at the top: within the translation home's top plus a little padding
  const reached = async (page: Page, kase: 'reach' | 'below') => {
    const end = await boxes(page)
    const limit = end.layerTop + end.translationHome + TOP_SLACK_PX
    if (end.rowsText === null || end.rowsText.top > limit) {
      values[kase === 'reach' ? 'rowsCantReachTop' : 'rowsBelowCantReachTop'] =
        1
      notes.push(
        `${kase}: the rows' text stopped at ${Math.round(end.rowsText?.top ?? -1)}px (their block at ${Math.round(end.rows?.top ?? -1)}px), over ${Math.round(limit)}px (the translation's home plus ${TOP_SLACK_PX}px)`
      )
    }
  }

  // reach: the translation down off its home, then the rows to the top
  {
    const { page, close } = await karaokePage(surface, url, KARAOKE)
    try {
      const start = await boxes(page)
      if (start.rows && start.translation) {
        await drag(
          page,
          TRANSLATION,
          start.rows.top - start.translation.top - 40
        )
      }
      await drag(page, ROWS, -2000)
      await reached(page, 'reach')
      await page.screenshot({ path: shot })
    } finally {
      await close()
    }
  }

  // below: the translation saved at the foot on its own, the rows a third of the way down, then the rows dragged up
  {
    const { page, close } = await karaokePage(surface, url, {
      ...KARAOKE,
      lyricsAnchor: '0.3',
      lyricsTranslationAnchor: '1',
    })
    try {
      const placed = await boxes(page)
      if (placed.docked) {
        throw new Error(
          'below: the translation loaded docked instead of below the rows'
        )
      }
      await drag(page, ROWS, -2000)
      await reached(page, 'below')
    } finally {
      await close()
    }
  }

  // keep: the rows nudged up, then the translation dragged from its home to the stage's foot, below them. It isn't
  // dropped onto them, so it never docks, and never rests over their lines. Twice:
  // - room: lines small enough for the translation to fit under them: the rows' lines don't move at all;
  // - tight: the song's lines at their usual size, the rows near the foot: they make way by no more than needed
  for (const kase of ['room', 'tight'] as const) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one page at a time
    const found = await keepCase(surface, url, kase)
    if (found.length > 0) {
      values.rowsMovedByTranslation = 1
      notes.push(...found)
    }
  }

  // onto: the translation off its home above the rows, then the rows dragged onto it
  {
    const { page, close } = await karaokePage(surface, url, KARAOKE)
    try {
      const start = await boxes(page)
      if (start.rows && start.translation) {
        await drag(
          page,
          TRANSLATION,
          Math.max(30, (start.rows.top - start.translation.bottom) / 2)
        )
      }
      const placed = await boxes(page)
      // The rows' drawn lines onto it, not their block: its empty reserve above a one-row pair isn't the rows
      if (placed.rowsText && placed.translation && !placed.docked) {
        const centre = (placed.translation.top + placed.translation.bottom) / 2
        await drag(page, ROWS, centre - placed.rowsText.top + 4)
      }
      const end = await boxes(page)
      if (!end.docked) {
        values.rowsOntoNoDock = 1
        notes.push(
          `onto: the rows dragged onto the translation didn't dock (rows ${JSON.stringify(end.rows)}, translation ${JSON.stringify(end.translation)})`
        )
      }
    } finally {
      await close()
    }
  }

  // saved: both at the foot, undocked, as a layout saved before overlaps were docked
  {
    const { page, close } = await karaokePage(surface, url, {
      ...KARAOKE,
      lyricsAnchor: '1',
      lyricsTranslationAnchor: '1',
    })
    try {
      const end = await boxes(page)
      if (!end.docked && overlap(end.rows, end.translation)) {
        values.savedOverlapped = 1
        notes.push(
          `saved: a layout saved overlapped loaded overlapped (rows ${JSON.stringify(end.rows)}, translation ${JSON.stringify(end.translation)})`
        )
      }
    } finally {
      await close()
    }
  }
  return { errors: [], samples: [{ notes, values }] }
}

/** Karaoke Style's dead-end check in one view */
export const lyricDockAudit =
  (surface: Surface) =>
  async (
    ctx: BenchContext
  ): Promise<{ samples: Sample[]; errors: string[] }> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    // oxlint-disable-next-line promise/avoid-new -- settles when the limit passes
    const stuck = new Promise<{ samples: Sample[]; errors: string[] }>(
      (resolve) => {
        timer = setTimeout(() => {
          resolve({
            errors: [`lyric dock audit stuck for ${LIMIT_MS / 1000}s`],
            samples: [],
          })
        }, LIMIT_MS)
      }
    )
    try {
      return await Promise.race([
        dockAudit(
          surface,
          `${ctx.origin}/v/${PLAYER_SONG}`,
          path.join(ctx.artifactDir, 'screen.png')
        ).catch((error: unknown) => ({
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
