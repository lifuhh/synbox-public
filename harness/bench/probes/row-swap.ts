// The swap between the rail's Translations and Romaji buttons (src/components/lyrics-display/row-swap.tsx), clicked
// in the page and sampled on every frame. A swap is a plain display change: the two rows under a lyric line trade
// places, the two buttons trade places with them, and nothing else moves or starts over. On desktop (the row under
// the video), the installed app on its side (the rail's column) and upright turned by Lock Landscape; Karaoke Style
// off, where a line has both rows under it. Each failure counts 1; the counts gate in `check` at 0:
// - orderMismatches: after a swap the rows under the line and the two buttons are not in the same order, or the
//   order changed when it should not have (an even number of presses) or did not when it should;
// - blockMoves: the lyrics' block (its handle's box) moved or resized, on any frame, by over BLOCK_PX;
// - remounts: a row under the line, or a part of the karaoke fill, is drawn by a new element after a swap;
// - buttonJumps: one of the two buttons' parts (Translations, Romaji: whichever button draws it) moved further in
//   one frame than its travel allows (STEP_PX per 60Hz frame), left the rail's line, or was drawn somewhere else
//   when the other button took it over (HANDOVER_PX);
// - overshoots: a part was drawn past either of the two places (OVERSHOOT_PX);
// - creeps: a part stayed within SETTLE_PX of its place for over SETTLE_FRAMES frames before landing;
// - neighbourMoves: any other button of the rail, or the swap itself, moved while the two traded or while the swap
//   came or went;
// - reducedMotionMoves: under Reduce Motion a part was drawn anywhere but in one of the two places;
// - pops: the swap came or went at once when a row was hidden or shown again (fewer than FADE_FRAMES frames drawn
//   part way), or was still shown, or still took focus, with a row hidden. A fade that changed across a frame the
//   machine stalled (motion.ts › stallLimit) was not seen, not a pop: the row is hidden and shown again, REDOS times
//   at most, and a fade stalled on every attempt leaves no sample (`machine stalled`), which `check` retries;
// - lostFocus: pressed with focus on it, the swap lost focus.
// Overshoot and settle use probes/motion.ts's thresholds. A case that couldn't run (no line on the stage, no swap
// on the rail) is an error, no sample.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { Page } from 'playwright'

import { open } from '../engines/browser'
import type { BenchContext, Sample, Surface } from '../types'
import { LAYOUT_PAGES, PLAYER_AUDIT_SEC, PLAYER_SONG } from './layout'
import { REDOS, stallLimit } from './motion'

const LIMIT_MS = 150_000
const MOVE_PX = 0.5
/** The lyrics' block is the same box in either order, to the hundredth of a pixel: a tenth is a change. Two orders
 * spaced in each row's own em differed by 0.15px (desktop) to 0.47px (a phone) */
const BLOCK_PX = 0.1
const HANDOVER_PX = 0.5
const OVERSHOOT_PX = 0.5
const SETTLE_PX = 2
const SETTLE_FRAMES = 4
/** A fade is drawn part way on at least this many frames (AGENTS.md › Motion) */
const FADE_FRAMES = 2
const VSYNC_MS = 1000 / 60
/** The furthest a part travels in one 60Hz frame: the two places are at most 88px apart and take 240ms, eased in and
 * out, whose fastest frame measured 16.9px; a jump of half the way is 44px */
const STEP_PX = 24

const RAIL = 'nav[aria-label="Player Controls"]'
const SWAP_LABEL = 'Swap Romaji and Translations'
const SWAP = `${RAIL} button[aria-label="${SWAP_LABEL}"]`
const PARTS = ['Translations', 'Romaji']
/** The row each of the two buttons shows or hides, as `data-row` names it */
const ROW_OF: Record<string, string> = {
  Romaji: 'romaji',
  Translations: 'translation',
}

const ONE_LINE = {
  lyricsShowRomaji: 'true',
  lyricsShowTranslation: 'true',
  lyricsTwoLines: JSON.stringify({ default: false, theater: false }),
}

export const ROW_SWAP_FINDINGS = [
  'orderMismatches',
  'blockMoves',
  'remounts',
  'buttonJumps',
  'overshoots',
  'creeps',
  'neighbourMoves',
  'reducedMotionMoves',
  'pops',
  'lostFocus',
] as const
type Finding = (typeof ROW_SWAP_FINDINGS)[number]

interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Frame {
  t: number
  /** Each part's box, wherever it is drawn, in the page's own axes */
  parts: Record<string, Box | null>
  /** Which button draws each part: the two trade parts on a swap */
  owners: Record<string, number>
  /** Every other button of the rail and the swap, each with its box */
  others: string
  block: Box | null
  swap: { opacity: number; visibility: string } | null
}

interface State {
  rows: string
  rail: string
  rowIds: string
  fillIds: string
}

export interface Recording {
  frames: Frame[]
  /** The frame each click landed in */
  presses: number[]
  before: State
  after: State
}

/* oxlint-disable unicorn/consistent-function-scoping -- the recorder runs in the page: nothing outside it is there */
/** Clicks `labels` one after the other, `gapMs` apart, and samples every frame until `forMs` has passed */
const record = async (
  page: Page,
  labels: string[],
  gapMs: number,
  forMs: number
): Promise<Recording> =>
  await page.evaluate(
    async ({ rail, swapSel, parts, presses, gap, total }) => {
      const back = new DOMMatrix(
        getComputedStyle(document.body).transform
      ).inverse()
      const round = (n: number) => Math.round(n * 100) / 100
      // A screen box in the page's own axes, which a page turned by Lock Landscape keeps
      const box = (el: Element | null) => {
        if (el === null) {
          return null
        }
        const r = el.getBoundingClientRect()
        const corners = [
          back.transformPoint(new DOMPoint(r.left, r.top)),
          back.transformPoint(new DOMPoint(r.right, r.bottom)),
        ]
        const xs = corners.map((p) => p.x)
        const ys = corners.map((p) => p.y)
        return {
          h: round(Math.max(...ys) - Math.min(...ys)),
          w: round(Math.max(...xs) - Math.min(...xs)),
          x: round(Math.min(...xs)),
          y: round(Math.min(...ys)),
        }
      }
      const ids = new WeakMap<Element, number>()
      let next = 0
      const idOf = (el: Element) => {
        const known = ids.get(el)
        if (known !== undefined) {
          return known
        }
        next += 1
        ids.set(el, next)
        return next
      }
      const sorted = (list: Element[]) =>
        list
          .map(idOf)
          .toSorted((a, b) => a - b)
          .join(',')
      const nav = document.querySelector(rail)
      const swap = document.querySelector<HTMLButtonElement>(swapSel)
      const buttons = () => [...(nav?.querySelectorAll('button') ?? [])]
      const labelOf = (button: Element) =>
        button.getAttribute('aria-label') ?? ''
      const block = () =>
        document.querySelector(
          '[data-lyric-rows-area] [data-lyrics-style-toggle]'
        )
      const state = () => {
        const rows = [
          ...(block()?.querySelectorAll<HTMLElement>('[data-row]') ?? []),
        ]
        return {
          fillIds: sorted([
            ...(block()?.querySelectorAll('.lyric-karaoke-part') ?? []),
          ]),
          rail: buttons()
            .map(labelOf)
            .filter((label) => parts.includes(label))
            .join(' > '),
          rowIds: sorted(rows),
          rows: rows.map((r) => r.dataset.row ?? '').join(' > '),
        }
      }
      const before = state()
      const frames: Frame[] = []
      const pressedAt: number[] = []
      const start = performance.now()
      // oxlint-disable-next-line promise/avoid-new -- resolves on the last sampled frame
      await new Promise<void>((resolve) => {
        const sample = () => {
          const now = performance.now() - start
          const due = presses[pressedAt.length]
          if (due !== undefined && now >= 100 + pressedAt.length * gap) {
            pressedAt.push(frames.length)
            buttons()
              .find((b) => labelOf(b) === due)
              ?.click()
          }
          const style = swap === null ? null : getComputedStyle(swap)
          frames.push({
            block: box(block()),
            others: buttons()
              .filter((b) => !parts.includes(labelOf(b)))
              .map((b) => {
                const at = box(b)
                return `${labelOf(b)}@${at?.x},${at?.y},${at?.w},${at?.h}`
              })
              .join('|'),
            owners: Object.fromEntries(
              parts.map((label) => {
                const owner = buttons().find((b) => labelOf(b) === label)
                return [label, owner === undefined ? 0 : idOf(owner)]
              })
            ),
            parts: Object.fromEntries(
              parts.map((label) => [
                label,
                box(buttons().find((b) => labelOf(b) === label) ?? null),
              ])
            ),
            swap:
              style === null
                ? null
                : {
                    opacity: Number(style.opacity),
                    visibility: style.visibility,
                  },
            t: now,
          })
          if (now > total) {
            resolve()
          } else {
            requestAnimationFrame(sample)
          }
        }
        requestAnimationFrame(sample)
      })
      return { after: state(), before, frames, presses: pressedAt }
    },
    {
      gap: gapMs,
      parts: PARTS,
      presses: labels,
      rail: RAIL,
      swapSel: SWAP,
      total: forMs,
    }
  )
/* oxlint-enable unicorn/consistent-function-scoping */

export type Flag = (finding: Finding, note: string) => void

const far = (a: Box, b: Box) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
const reversed = (order: string) => order.split(' > ').toReversed().join(' > ')
/** The Japanese row leads either way; the two under it trade */
const under = (rows: string) => rows.replace(/^japanese > /u, '')
const asRows = (rail: string) =>
  rail
    .split(' > ')
    .map((label) => ROW_OF[label] ?? label)
    .join(' > ')
const spanOf = (frame: Frame, prev: Frame) =>
  Math.max((frame.t - prev.t) / VSYNC_MS, 1)

/** Where the rows and the buttons ended, and whether anything was drawn anew */
const judgeEnds = (
  name: string,
  { before, after }: Recording,
  swaps: number,
  flag: Flag
) => {
  const wanted =
    swaps % 2 === 1 ? reversed(under(before.rows)) : under(before.rows)
  if (under(after.rows) !== wanted || asRows(after.rail) !== wanted) {
    flag(
      'orderMismatches',
      `${name}: rows ${before.rows} → ${after.rows}, buttons ${before.rail} → ${after.rail}`
    )
  }
  if (after.rowIds !== before.rowIds || after.fillIds !== before.fillIds) {
    flag(
      'remounts',
      `${name}: the rows or the fill's parts are drawn by new elements (rows ${before.rowIds} → ${after.rowIds}, fill parts ${before.fillIds} → ${after.fillIds})`
    )
  }
}

/** The lyrics' block and every button but the two stay as they were on the first frame */
const judgeStill = (name: string, frames: Frame[], flag: Flag) => {
  const [first] = frames
  if (first === undefined) {
    return
  }
  const moved = Math.max(
    0,
    ...frames.map((f) =>
      f.block === null || first.block === null
        ? 0
        : Math.max(
            far(f.block, first.block),
            Math.abs(f.block.w - first.block.w),
            Math.abs(f.block.h - first.block.h)
          )
    )
  )
  if (moved > BLOCK_PX) {
    flag(
      'blockMoves',
      `${name}: the lyrics' block moved or resized by ${moved.toFixed(2)}px`
    )
  }
  const elsewhere = frames.filter((f) => f.others !== first.others).length
  if (elsewhere > 0) {
    flag(
      'neighbourMoves',
      `${name}: another button of the rail was drawn elsewhere on ${elsewhere} frames`
    )
  }
}

interface Places {
  a: Box
  b: Box
  column: boolean
}

/** The two buttons' places, from a frame at rest */
const placesOf = (frame: Frame | undefined): Places | null => {
  const [a, b] = PARTS.map((label) => frame?.parts[label] ?? null)
  return a === null || a === undefined || b === null || b === undefined
    ? null
    : { a, b, column: Math.abs(a.y - b.y) > Math.abs(a.x - b.x) }
}

/** One part's boxes, frame by frame (null where it was not drawn) */
const pathOf = (frames: Frame[], label: string) =>
  frames.map((f) => f.parts[label] ?? null)

/** A part stays between the two places and on the rail's line; under Reduce Motion, in one of the two places */
const judgeBounds = (
  name: string,
  label: string,
  boxes: (Box | null)[],
  { a, b, column }: Places,
  reduced: boolean,
  flag: Flag
) => {
  const along = (at: Box) => (column ? at.y : at.x)
  const across = (at: Box) => (column ? at.x : at.y)
  const low = Math.min(along(a), along(b))
  const high = Math.max(along(a), along(b))
  const drawn = boxes.flatMap((at, n) => (at === null ? [] : [{ at, n }]))
  const past = drawn.find(
    ({ at }) => Math.max(low - along(at), along(at) - high) > OVERSHOOT_PX
  )
  if (past !== undefined) {
    flag(
      'overshoots',
      `${name}: ${label} drawn ${Math.max(low - along(past.at), along(past.at) - high).toFixed(1)}px past its two places at frame ${past.n}`
    )
  }
  const off = drawn.find(({ at }) => Math.abs(across(at) - across(a)) > MOVE_PX)
  if (off !== undefined) {
    flag(
      'buttonJumps',
      `${name}: ${label} left the rail's line by ${Math.abs(across(off.at) - across(a)).toFixed(1)}px at frame ${off.n}`
    )
  }
  const between = reduced
    ? drawn.find(({ at }) => Math.min(far(at, a), far(at, b)) > MOVE_PX)
    : undefined
  if (between !== undefined) {
    flag(
      'reducedMotionMoves',
      `${name}: ${label} drawn ${Math.min(far(between.at, a), far(between.at, b)).toFixed(1)}px from either place at frame ${between.n} under Reduce Motion`
    )
  }
}

/** A part never steps further in a frame than its travel does, the frame the other button takes it over included */
const judgeSteps = (
  name: string,
  label: string,
  frames: Frame[],
  flag: Flag
) => {
  const boxes = pathOf(frames, label)
  for (const [n, frame] of frames.entries()) {
    const prev = frames[n - 1]
    const at = boxes[n]
    const was = boxes[n - 1]
    if (prev === undefined || at === null || at === undefined || !was) {
      continue
    }
    // The frame the other button takes the part over (the frame of the click, or the next: WebKit draws the click's
    // change a frame on). From rest that is in place, however late the frame; mid-move the part was already
    // travelling, and its last frame's step shows here
    const earlier = boxes[n - 2]
    const handover =
      frame.owners[label] !== prev.owners[label] &&
      earlier !== null &&
      earlier !== undefined &&
      far(was, earlier) <= 0.1
    const allowed = handover ? HANDOVER_PX + 0.5 : STEP_PX * spanOf(frame, prev)
    if (far(at, was) > allowed) {
      flag(
        'buttonJumps',
        `${name}: ${label} moved ${far(at, was).toFixed(1)}px in one frame (frame ${n}, ${(frame.t - prev.t).toFixed(0)}ms${handover ? ', as the other button took it over' : ''}; allowed ${allowed.toFixed(1)}px)`
      )
      return
    }
  }
}

/** A part lands within SETTLE_FRAMES frames of coming within SETTLE_PX of where it ends */
const judgeSettle = (
  name: string,
  label: string,
  boxes: (Box | null)[],
  flag: Flag
) => {
  const end = boxes.at(-1)
  if (end === null || end === undefined) {
    return
  }
  let close = 0
  for (const at of boxes) {
    const off = at === null ? 0 : far(at, end)
    close = off <= SETTLE_PX && off > 0.1 ? close + 1 : 0
    if (close > SETTLE_FRAMES) {
      flag(
        'creeps',
        `${name}: ${label} crept within ${SETTLE_PX}px of its place for over ${SETTLE_FRAMES} frames`
      )
      return
    }
  }
}

/** The frames of one or two swaps, judged; `reduced`: under Reduce Motion nothing travels */
export const judgeSwap = (
  name: string,
  recording: Recording,
  swaps: number,
  reduced: boolean,
  flag: Flag
): void => {
  const { frames } = recording
  judgeEnds(name, recording, swaps, flag)
  judgeStill(name, frames, flag)
  const places = placesOf(frames[0])
  if (places === null) {
    return
  }
  for (const label of PARTS) {
    const boxes = pathOf(frames, label)
    judgeBounds(name, label, boxes, places, reduced, flag)
    if (!reduced) {
      judgeSteps(name, label, frames, flag)
      judgeSettle(name, label, boxes, flag)
    }
  }
}

const opacityOf = (f: Frame | undefined) => f?.swap?.opacity ?? 0

const gapAt = (frames: Frame[], n: number) => {
  const frame = frames[n]
  const prev = frames[n - 1]
  return frame === undefined || prev === undefined ? 0 : frame.t - prev.t
}

/**
 * The stalled frame gap the swap's opacity changed across, as a note; null when every change came between frames on
 * time. A change on the frame after a stalled one counts too: Chromium draws what the stall swallowed there (a fade's
 * first frame after a 234ms gap at full opacity, the next one at 0)
 */
const fadeStall = (frames: Frame[]): string | null => {
  const limitMs = stallLimit(frames.map((f) => f.t))
  for (const [n, frame] of frames.entries()) {
    const gapMs = Math.max(gapAt(frames, n), gapAt(frames, n - 1))
    if (
      gapMs > limitMs &&
      Math.abs(opacityOf(frame) - opacityOf(frames[n - 1])) > 0.02
    ) {
      return `the fade crossed a ${gapMs.toFixed(0)}ms frame gap at frame ${n} (over ${limitMs.toFixed(0)}ms)`
    }
  }
  return null
}

/**
 * The frames of a row hidden or shown again: the swap fades, its place and every other button stay. Returns the stall
 * that hid a fade drawn on too few frames, judging nothing else; then the recording is made again
 */
export const judgeHide = (
  name: string,
  { frames }: Recording,
  hidden: boolean,
  flag: Flag
): string | null => {
  const [first] = frames
  const last = frames.at(-1)
  if (first === undefined || last === undefined) {
    return null
  }
  // Counted in frames drawn part way, not as a step per frame: the toggle's own long frame comes first in WebKit,
  // and a step allowed for each frame it took would let a control that went at once through
  const partWay = frames.filter(
    (f) => f.swap !== null && f.swap.opacity > 0.02 && f.swap.opacity < 0.98
  ).length
  const stall = partWay < FADE_FRAMES ? fadeStall(frames) : null
  if (stall !== null) {
    return `${name}: ${stall}`
  }
  if (frames.some((f) => f.others !== first.others)) {
    flag('neighbourMoves', `${name}: a button of the rail moved`)
  }
  if (partWay < FADE_FRAMES) {
    flag(
      'pops',
      `${name}: the swap came or went with ${partWay} frames drawn part way (at least ${FADE_FRAMES})`
    )
  }
  const shown = last.swap !== null && last.swap.opacity > 0.01
  if (shown === hidden || (hidden && last.swap?.visibility !== 'hidden')) {
    flag(
      'pops',
      `${name}: the swap ended at opacity ${last.swap?.opacity ?? -1}, visibility ${last.swap?.visibility ?? 'none'}`
    )
  }
  return null
}

const pressLabel = async (page: Page, label: string) => {
  const pressed = await page.evaluate((name) => {
    const button = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${name}"]`
    )
    button?.click()
    return button !== null
  }, label)
  if (!pressed) {
    throw new Error(`no "${label}" button`)
  }
}

/** The player with one line and both rows on the stage, paused so the controls stay up, and the swap on the rail */
const swapPage = async (
  surface: Surface,
  url: string,
  turned: boolean,
  reduced: boolean
) => {
  const player = LAYOUT_PAGES.find((p) => p.name === 'player')
  if (player === undefined) {
    throw new Error('no player page in LAYOUT_PAGES')
  }
  const opened = await open(surface)
  try {
    await opened.context.addInitScript((stored) => {
      for (const [key, value] of Object.entries(stored)) {
        localStorage.setItem(key, value)
      }
    }, ONE_LINE)
    const { page } = opened
    if (reduced) {
      await page.emulateMedia({ reducedMotion: 'reduce' })
    }
    await page.goto(url, { waitUntil: 'commit' })
    await player.ready(page)
    if (turned) {
      // Rotation lock on: Full Screen from upright turns the page
      await pressLabel(page, 'Fullscreen')
      await page.waitForTimeout(1500)
      const isTurned = await page.evaluate(() =>
        Object.hasOwn(document.documentElement.dataset, 'landscapeLock')
      )
      if (!isTurned) {
        throw new Error('Full Screen did not turn the page')
      }
    }
    // Paused, the controls stay up and the line stays
    await page.evaluate(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-player-chrome] button[aria-label=Pause]'
        )
        ?.click()
    })
    await page.waitForTimeout(900)
    const found = await page.evaluate(
      ({ swapSel }) => ({
        rows: document.querySelectorAll(
          '[data-lyric-rows-area] [data-lyrics-style-toggle] [data-row]'
        ).length,
        swap: document.querySelector(swapSel) !== null,
      }),
      { swapSel: SWAP }
    )
    if (found.rows !== 3 || !found.swap) {
      throw new Error(
        `nothing to swap: ${found.rows} rows under the line, ${found.swap ? 'the' : 'no'} swap on the rail`
      )
    }
  } catch (error) {
    await opened.close()
    throw error
  }
  return opened
}

/** Whether the swap holds focus: after `focus()`, and with `click` after its own click and two frames */
const swapFocused = async (page: Page, click: boolean): Promise<boolean> =>
  await page.evaluate(
    async ({ swapSel, press }) => {
      const button = document.querySelector<HTMLButtonElement>(swapSel)
      button?.focus()
      if (press) {
        button?.click()
        // oxlint-disable-next-line promise/avoid-new -- two frames on
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve()
            })
          })
        })
      }
      return button !== null && document.activeElement === button
    },
    { press: click, swapSel: SWAP }
  )

const swapAudit = async (
  surface: Surface,
  turned: boolean,
  url: string,
  artifactDir: string
): Promise<{ samples: Sample[]; errors: string[] }> => {
  const values: Record<string, number> = Object.fromEntries(
    ROW_SWAP_FINDINGS.map((k) => [k, 0])
  )
  const notes: string[] = []
  const flag: Flag = (finding, note) => {
    values[finding] = (values[finding] ?? 0) + 1
    notes.push(`${finding}: ${note}`)
  }
  const kept: Record<string, Recording> = {}
  mkdirSync(artifactDir, { recursive: true })
  const moving = await swapPage(surface, url, turned, false)
  try {
    const { page } = moving
    kept.there = await record(page, [SWAP_LABEL], 0, 700)
    judgeSwap('a swap', kept.there, 1, false, flag)
    kept.back = await record(page, [SWAP_LABEL], 0, 700)
    judgeSwap('a swap back', kept.back, 1, false, flag)
    // A second press 100ms into the first: the two turn back from where they are
    kept.twice = await record(page, [SWAP_LABEL, SWAP_LABEL], 100, 900)
    judgeSwap('a second press mid-move', kept.twice, 2, false, flag)
    // Hidden and shown again as a pair, so an attempt a stall spoiled is made again from where the first began
    const stalls: string[] = []
    for (let attempt = 0; ; attempt += 1) {
      const found: [Finding, string][] = []
      const keep: Flag = (finding, note) => {
        found.push([finding, note])
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- one attempt at a time, each judged before the next
      kept.hide = await record(page, ['Romaji'], 0, 600)
      const hideStall = judgeHide('Romaji hidden', kept.hide, true, keep)
      // oxlint-disable-next-line eslint/no-await-in-loop -- the hidden state, before Romaji is shown again
      if (await swapFocused(page, false)) {
        keep('pops', 'the swap takes focus while Romaji is hidden')
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- shown again, back where the attempt began
      kept.show = await record(page, ['Romaji'], 0, 600)
      const stall =
        judgeHide('Romaji shown again', kept.show, false, keep) ?? hideStall
      if (stall === null) {
        for (const [finding, note] of found) {
          flag(finding, note)
        }
        break
      }
      stalls.push(`attempt ${attempt + 1}: ${stall}`)
      if (attempt === REDOS) {
        throw new Error(
          `machine stalled: Romaji hidden and shown again stalled on all ${REDOS + 1} attempts (${stalls.join('; ')})`
        )
      }
    }
    notes.push(...stalls.map((s) => `redo: ${s}`))
    values.redos = stalls.length
    if (!(await swapFocused(page, true))) {
      flag('lostFocus', 'focus left the swap when it was pressed')
    }
    values.frames = kept.there.frames.length
    // Where it came to rest; WebKit sometimes never finishes a screenshot, and the verdict doesn't need it
    await page
      .screenshot({ path: path.join(artifactDir, 'screen.png'), timeout: 5000 })
      .catch(() => {
        // No screenshot this run
      })
  } finally {
    await moving.close()
  }
  const still = await swapPage(surface, url, turned, true)
  try {
    kept.reduced = await record(still.page, [SWAP_LABEL], 0, 500)
    judgeSwap('a swap under Reduce Motion', kept.reduced, 1, true, flag)
  } finally {
    await still.close()
  }
  writeFileSync(path.join(artifactDir, 'frames.json'), JSON.stringify(kept))
  return { errors: [], samples: [{ notes, values }] }
}

/** The rail's swap in one view; `turned`: an upright phone turned by Lock Landscape */
export const rowSwapAudit =
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
            errors: [`row swap audit stuck for ${LIMIT_MS / 1000}s`],
            samples: [],
          })
        }, LIMIT_MS)
      }
    )
    try {
      return await Promise.race([
        swapAudit(
          surface,
          turned,
          `${ctx.origin}/v/${PLAYER_SONG}?t=${PLAYER_AUDIT_SEC}`,
          ctx.artifactDir
        ).catch((error: unknown) => ({
          errors: [
            (error instanceof Error ? error.message : String(error)).split(
              '\n'
            )[0] ?? '',
          ],
          samples: [],
        })),
        stuck,
      ])
    } finally {
      clearTimeout(timer)
    }
  }
