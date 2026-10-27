// How smoothly a continuous drag runs: a slider's knob, a seek bar, a dragged block. A real pointer presses the handle
// and sweeps it back and forth, one move a frame as a hand drags, while the page records the time of every frame it
// renders. A drag step that makes the page re-lay out the world shows as frames that come late; this audit counts them.
//
// - slow frame: a gap between two rendered frames over SLOW_FRAME_MS while the drag runs. The page's own work in that
//   frame (the move's handlers, React's render, layout) kept the next frame from coming;
// - blocked: per move, the drag's frame time past one 60Hz frame (sum over its frames of gap − 16.7ms, divided by the
//   moves). A drag that runs at 60fps blocks ~0ms a move.
//
// Budgets (per drag, per engine: BUDGETS): at most `slowFrames` slow frames and `blockedMs` blocked a move; each drag
// over budget counts 1 in `slowDrags`, which `check` gates at 0. The raw numbers are reported beside it.
//
// Stall rule (as the motion audits since fe#594): a slow frame is the page's or the machine's. Before and after each
// drag the page is watched idle for IDLE_MS; a gap over STALL_MS there means the machine stalled around the drag, and a
// drag over budget then is run again (REDOS times at most) instead of failing. A stall never passes a drag: a drag
// over budget with every attempt stalled leaves no sample (`machine stalled`), which `check` retries like any audit
// that measured nothing. A drag within budget passes whatever the machine did (a stall only adds time).
//
// Budgets, from the Lyrics Size slider dragged across its whole track, 120 moves, translation shown, every engine at
// full speed (2026-10-27, one run each). Last good build (main aacd8177), web: Karaoke Style 3.7ms blocked a move and
// 0 slow frames, one line 0.1ms and 0. The regression this audit was written for (staging 683e1359, fitSong re-fitting
// the whole song on every step): web Karaoke Style 48.1ms and 57. Headless WebKit at the phones' 3× scale is slow on
// both builds (main: Karaoke Style 63.9ms and 60, one line 13.6-18.4ms and 29-43; staging: 94.3ms and 83, one line
// 12.9-14.7ms), and its runs vary by a third, so its budget catches only a drag about twice as slow as main's.

import type { Page } from 'playwright'

import { open } from '../engines/browser'
import type { BenchContext, Sample, Surface } from '../types'
import { LAYOUT_PAGES, PLAYER_SONG } from './layout'

const LIMIT_MS = 180_000
const VSYNC_MS = 1000 / 60
/** A frame this late is a dropped frame the user sees: three refreshes */
const SLOW_FRAME_MS = 50
/** Per engine: the last good build's worst, with headroom for machine noise (see the top of this file) */
const BUDGETS: Record<
  Surface['engine'],
  { slowFrames: number; blockedMs: number }
> = {
  chromium: { blockedMs: 10, slowFrames: 8 },
  webkit: { blockedMs: 130, slowFrames: 120 },
}
/** An idle gap past this, with nothing driving the page, is the machine (motion.ts › STALL_MS) */
const STALL_MS = 50
const IDLE_MS = 600
const REDOS = 2
/** Moves per sweep across the track, a frame apart; sweeps alternate direction */
const MOVES = 30
const SWEEPS = 4
/** After the drag: the page's deferred work after a drop (a lazy re-fit) runs before the idle watch */
const SETTLE_MS = 1500

interface Point {
  x: number
  y: number
}

/** One continuous drag: where to press, and where to sweep to and back */
export interface DragPath {
  from: Point
  to: Point
}

/** What the page recorded during one drag */
export interface DragRecord {
  /** Gaps between frames while the drag ran (press to release, plus the frame after) */
  gaps: number[]
  /** Gaps between frames while the page sat idle before and after it */
  idleGaps: number[]
  moves: number
}

export interface DragResult {
  slowFrames: number
  blockedPerMoveMs: number
  worstFrameMs: number
  stalled: boolean
  over: boolean
}

declare global {
  interface Window {
    __dragFrames?: {
      times: number[]
      marks: Record<string, number>
      on: boolean
    }
    __sizeChanges?: { changes: number }
  }
}

const startFrames = async (page: Page) => {
  await page.evaluate(() => {
    const state = { marks: {}, on: true, times: [] as number[] }
    window.__dragFrames = state
    const loop = (now: number) => {
      if (!state.on) {
        return
      }
      state.times.push(now)
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
}

const markFrames = async (page: Page, name: string) => {
  await page.evaluate((n) => {
    const state = window.__dragFrames
    if (state) {
      state.marks[n] = performance.now()
    }
  }, name)
}

const stopFrames = async (page: Page) =>
  await page.evaluate(() => {
    const state = window.__dragFrames
    if (!state) {
      return { marks: {}, times: [] }
    }
    state.on = false
    return { marks: state.marks, times: state.times }
  })

const gapsBetween = (times: number[], from: number, to: number) => {
  const gaps: number[] = []
  for (let i = 1; i < times.length; i += 1) {
    const t = times[i]
    const before = times[i - 1]
    if (t !== undefined && before !== undefined && t > from && before < to) {
      gaps.push(t - before)
    }
  }
  return gaps
}

/**
 * Presses at `path.from`, sweeps to `path.to` and back SWEEPS times in MOVES moves each, a frame apart, and releases;
 * the page's frames recorded throughout, with an idle watch before and after
 */
export const recordDrag = async (
  page: Page,
  path: DragPath
): Promise<DragRecord> => {
  await startFrames(page)
  await page.waitForTimeout(IDLE_MS)
  await markFrames(page, 'press')
  await page.mouse.move(path.from.x, path.from.y)
  await page.mouse.down()
  let moves = 0
  for (let sweep = 0; sweep < SWEEPS; sweep += 1) {
    const [a, b] = sweep % 2 === 0 ? [path.from, path.to] : [path.to, path.from]
    for (let step = 1; step <= MOVES; step += 1) {
      const f = step / MOVES
      // oxlint-disable-next-line eslint/no-await-in-loop -- one move a frame, as a hand drags
      await page.mouse.move(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f)
      moves += 1
      // oxlint-disable-next-line eslint/no-await-in-loop -- the frame between moves
      await page.waitForTimeout(16)
    }
  }
  await page.mouse.up()
  // The frame that draws the last move
  await page.waitForTimeout(100)
  await markFrames(page, 'release')
  await page.waitForTimeout(SETTLE_MS)
  await markFrames(page, 'idle')
  await page.waitForTimeout(IDLE_MS)
  const { marks, times } = await stopFrames(page)
  const press = marks.press ?? 0
  const release = marks.release ?? 0
  const idle = marks.idle ?? 0
  return {
    gaps: gapsBetween(times, press, release),
    idleGaps: [
      ...gapsBetween(times, 0, press),
      ...gapsBetween(times, idle, Number.POSITIVE_INFINITY),
    ],
    moves,
  }
}

export interface DragBudget {
  slowFrames: number
  blockedMs: number
}

export const judgeDrag = (r: DragRecord, budget: DragBudget): DragResult => {
  const slowFrames = r.gaps.filter((g) => g > SLOW_FRAME_MS).length
  const blocked = r.gaps.reduce((sum, g) => sum + Math.max(0, g - VSYNC_MS), 0)
  const blockedPerMoveMs = r.moves === 0 ? 0 : blocked / r.moves
  return {
    blockedPerMoveMs: Math.round(blockedPerMoveMs * 10) / 10,
    over: slowFrames > budget.slowFrames || blockedPerMoveMs > budget.blockedMs,
    slowFrames,
    stalled: r.idleGaps.some((g) => g > STALL_MS),
    worstFrameMs: Math.round(Math.max(0, ...r.gaps)),
  }
}

/** One drag judged, run again while a machine stall stands beside a drag over budget; null when every attempt stalled */
export const measuredDrag = async (
  run: () => Promise<DragRecord>,
  budget: DragBudget,
  notes: string[],
  what: string
): Promise<(DragResult & { redos: number }) | null> => {
  for (let attempt = 0; attempt <= REDOS; attempt += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one attempt at a time, each judged before the next
    const result = judgeDrag(await run(), budget)
    if (!result.over || !result.stalled) {
      return { ...result, redos: attempt }
    }
    notes.push(
      `${what}, attempt ${attempt + 1}: over budget beside a machine stall (${result.slowFrames} slow frames, ${result.blockedPerMoveMs}ms blocked a move); run again`
    )
  }
  return null
}

/** The slider's knob (role=slider) inside `scope`, and its track's ends, inset so the sweep stays on the track */
export const sliderPath = async (
  page: Page,
  thumb: string
): Promise<DragPath> => {
  const found = await page.evaluate((sel) => {
    const knob = document.querySelector(sel)
    // The slider's own box: the knob's nearest ancestor that is long one way (a page turned by Lock Landscape stands it
    // up on screen)
    let box: DOMRect | undefined
    for (let n = knob?.parentElement; n; n = n.parentElement) {
      const r = n.getBoundingClientRect()
      if (Math.max(r.width, r.height) > 4 * Math.min(r.width, r.height)) {
        box = r
        break
      }
    }
    const k = knob?.getBoundingClientRect()
    if (!box || !k) {
      return null
    }
    return {
      box: { b: box.bottom, l: box.left, r: box.right, t: box.top },
      knob: { x: k.left + k.width / 2, y: k.top + k.height / 2 },
    }
  }, thumb)
  if (found === null) {
    throw new Error(`no slider knob ${thumb}`)
  }
  const { box, knob } = found
  // Along its long side on screen: a page turned by Lock Landscape runs it down the screen
  const across = box.r - box.l >= box.b - box.t
  const inset = 0.08
  return across
    ? {
        from: knob,
        to: {
          x:
            knob.x > (box.l + box.r) / 2
              ? box.l + (box.r - box.l) * inset
              : box.r - (box.r - box.l) * inset,
          y: knob.y,
        },
      }
    : {
        from: knob,
        to: {
          x: knob.x,
          y:
            knob.y > (box.t + box.b) / 2
              ? box.t + (box.b - box.t) * inset
              : box.b - (box.b - box.t) * inset,
        },
      }
}

/* ---- The player's drags ---- */

/** The lyrics' layout during the drag, each with the translation shown (the default) */
export type DragLayout = 'one-line' | 'karaoke' | 'karaoke-docked'
const LAYOUT_PREFS: Record<DragLayout, Record<string, string>> = {
  karaoke: {
    lyricsShowTranslation: 'true',
    lyricsTranslationDocked: 'false',
    lyricsTwoLines: JSON.stringify({ default: true, theater: true }),
  },
  'karaoke-docked': {
    lyricsShowTranslation: 'true',
    lyricsTranslationDocked: 'true',
    lyricsTwoLines: JSON.stringify({ default: true, theater: true }),
  },
  'one-line': {
    lyricsShowTranslation: 'true',
    lyricsTwoLines: JSON.stringify({ default: false, theater: false }),
  },
}

/** Lyrics Style's size slider; Radix names the knob after the slider */
export const SIZE_KNOB = '[role=dialog] [role=slider][aria-label="Lyrics Size"]'

const showControls = async (page: Page) => {
  await page.mouse.move(60, 60)
  await page.waitForTimeout(400)
}

export const pressNamed = async (page: Page, name: string) => {
  await showControls(page)
  const button = page.getByRole('button', { exact: true, name }).first()
  await button.click({ timeout: 5000 })
  await page.waitForTimeout(600)
}

/**
 * The player, paused on a sung line, ready for the drag: Lyrics Style open for the size slider. Every engine at full
 * speed: WebKit has no CPU slowdown (browser.ts › open), so one budget holds for every view
 */
export const playerReady = async (
  surface: Surface,
  url: string,
  layout: DragLayout,
  fullscreen: boolean
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
  }, LAYOUT_PREFS[layout])
  const { page } = opened
  try {
    await page.goto(url, { waitUntil: 'commit' })
    await player.ready(page)
    if (fullscreen) {
      await pressNamed(page, 'Fullscreen')
    }
    // Onto a sung line: the stage draws the song's lines, not the title card
    for (let skips = 0; skips < 8; skips += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one look, then a press
      const lines = await page
        .locator(
          layout === 'one-line'
            ? '[data-lyric-line], [data-lyric-row]'
            : '[data-lyric-row]'
        )
        .count()
      if (lines > 0) {
        break
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- the player skips 5 s a press
      await page.keyboard.press('ArrowRight')
      // oxlint-disable-next-line eslint/no-await-in-loop -- the lines settle
      await page.waitForTimeout(1200)
    }
    await page.keyboard.press('k')
    await page.waitForTimeout(600)
    return opened
  } catch (error) {
    await opened.close()
    throw error
  }
}

export interface DragCase {
  /** Shown in notes */
  label: string
  layout: DragLayout
  /** Full Screen first (an upright phone's slider is on the full-screen player only) */
  fullscreen: boolean
}

const sizeDrag = async (
  surface: Surface,
  url: string,
  c: DragCase,
  notes: string[]
) => {
  const { page, close } = await playerReady(
    surface,
    url,
    c.layout,
    c.fullscreen
  )
  try {
    await pressNamed(page, 'Lyrics Style')
    await page.locator(SIZE_KNOB).first().waitFor({ timeout: 5000 })
    return await measuredDrag(
      async () => {
        // Counts the knob's value changes, so a drag that stopped moving the slider can't pass as smooth
        await page.evaluate((sel) => {
          const knob = document.querySelector(sel)
          const seen = { changes: 0 }
          window.__sizeChanges = seen
          if (knob) {
            new MutationObserver((records) => {
              seen.changes += records.length
            }).observe(knob, { attributeFilter: ['aria-valuenow'] })
          }
        }, SIZE_KNOB)
        const record = await recordDrag(page, await sliderPath(page, SIZE_KNOB))
        const changes = await page.evaluate(
          () => window.__sizeChanges?.changes ?? 0
        )
        // A short track has fewer steps than a sweep has moves, so not every move changes it
        if (changes < record.moves / 4) {
          throw new Error(
            `the size slider changed ${changes} times in ${record.moves} moves: the drag didn't drive it`
          )
        }
        return record
      },
      BUDGETS[surface.engine],
      notes,
      `lyrics size, ${c.label}`
    )
  } finally {
    await close()
  }
}

/** The Lyrics Size slider dragged in one view, each case on its own page: each drag over budget counts in `slowDrags` */
export const sizeDragAudit =
  (surface: Surface, cases: DragCase[]) =>
  async (
    ctx: BenchContext
  ): Promise<{ samples: Sample[]; errors: string[] }> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    // oxlint-disable-next-line promise/avoid-new -- settles when the limit passes
    const stuck = new Promise<{ samples: Sample[]; errors: string[] }>(
      (resolve) => {
        timer = setTimeout(() => {
          resolve({
            errors: [`drag audit stuck for ${LIMIT_MS / 1000}s`],
            samples: [],
          })
        }, LIMIT_MS)
      }
    )
    const url = `${ctx.origin}/v/${PLAYER_SONG}`
    const audit = async (): Promise<{
      samples: Sample[]
      errors: string[]
    }> => {
      const notes: string[] = []
      const values = {
        blockedPerMoveMs: 0,
        redos: 0,
        slowDrags: 0,
        slowFrames: 0,
        worstFrameMs: 0,
      }
      for (const c of cases) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one page at a time: timing
        const r = await sizeDrag(surface, url, c, notes)
        if (r === null) {
          return {
            errors: [
              `machine stalled: lyrics size, ${c.label} over budget beside a stall on all ${REDOS + 1} attempts`,
            ],
            samples: [],
          }
        }
        notes.push(
          `lyrics size, ${c.label}: ${r.slowFrames} frames over ${SLOW_FRAME_MS}ms (budget ${BUDGETS[surface.engine].slowFrames}), ${r.blockedPerMoveMs}ms blocked a move (budget ${BUDGETS[surface.engine].blockedMs}), worst frame ${r.worstFrameMs}ms`
        )
        values.slowDrags += r.over ? 1 : 0
        values.slowFrames = Math.max(values.slowFrames, r.slowFrames)
        values.blockedPerMoveMs = Math.max(
          values.blockedPerMoveMs,
          r.blockedPerMoveMs
        )
        values.worstFrameMs = Math.max(values.worstFrameMs, r.worstFrameMs)
        values.redos += r.redos
      }
      return { errors: [], samples: [{ notes, values }] }
    }
    try {
      return await Promise.race([
        audit().catch((error: unknown) => ({
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
