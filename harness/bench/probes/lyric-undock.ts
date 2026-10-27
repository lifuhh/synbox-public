// Karaoke Style's docked translation taken off the rows and put back, by real pointer drags: the rows never move
// (owner, 2026-10-27). The translation docked under the rows, the block dragged to the middle of the stage, then the
// translation dragged out of it to four places, each followed by a drag back onto the block:
// - bottom: past the stage's foot;
// - top: past the stage's top;
// - below: just under the block (as close as a pull that comes off allows);
// - inside: onto the rows' lines, inside the block.
// Sampled on every frame of each drag and of its settling, boxes in the page's axes (Lock Landscape's turned page
// included):
// - the rows' drawn lines may not move (more than 1px) from where they were before the drag;
// - the translation's drawn text may never overlap the rows' lines, and once off the rows never the block's area (the
//   rows' lines plus the place the docked translation took);
// - pulled to the bottom or the top with room there for it, it comes off (a fix that never lets it go passes nothing);
// - let go inside the block, it ends docked or outside the block;
// - dragged back onto the block, it docks.
// At the default size and the largest. Each failing case counts 1 in its metric; `check` gates each at 0. The
// largest row move and overlap in pixels are reported beside them.

import path from 'node:path'

import type { Page } from 'playwright'

import { open } from '../engines/browser'
import type { BenchContext, Sample, Surface } from '../types'
import { LAYOUT_PAGES, PLAYER_SONG } from './layout'

/** Past this a move is a move; below it, subpixel rounding */
const MOVED_PX = 1
/** Past this an overlap is an overlap (antialiased glyph edges touch) */
const OVERLAP_PX = 1
const LIMIT_MS = 240_000
/** Moves per drag, a frame apart */
const STEPS = 24
/** A drop's places come to rest: the drag's end, a 200ms ease, any settle the app does after a drop */
const SETTLE_MS = 1000

const ROWS = '[data-lyric-rows-area] [data-lyrics-style-toggle]'
const TRANSLATION = '[data-lyric-translation] [data-lyrics-style-toggle]'
const DOCKED_TEXT =
  '[data-docked-translation="docked"] .docked-translation-text'

/** The default Karaoke size, and the largest the slider gives */
const SIZES = [
  { label: 'default size', pref: null },
  { label: 'largest size', pref: '1.1' },
] as const

const KARAOKE = {
  lyricsShowTranslation: 'true',
  lyricsTranslationDocked: 'true',
  lyricsTwoLines: JSON.stringify({ default: true, theater: true }),
}

interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

/** One frame: every box in the page's axes, within the lyrics' layer */
interface Frame {
  layer: Box
  /** Each of the rows' lines, drawn (their glyphs) */
  rows: (Box | null)[]
  rowsText: Box | null
  /** The rows' block, the docked translation's place included */
  block: Box | null
  /** Where the docked translation sits, while it is docked */
  slot: Box | null
  docked: boolean
  /** The translation's drawn text, docked (pulled or not) or on its own; previews of where it would go left out */
  translation: Box | null
}

/** What installMeter leaves in the page */
interface UndockMeter {
  measure: () => Frame
  start: () => void
  stop: () => Frame[]
  turned: () => boolean
}
declare global {
  interface Window {
    __undockMeter?: UndockMeter
  }
}

/** Installed in every page: measures a Frame, and records one per animation frame between start and stop */
const installMeter = () => {
  interface PageBox {
    top: number
    bottom: number
    left: number
    right: number
  }
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page: nothing outside this function is there
  const turned = () =>
    Object.hasOwn(document.documentElement.dataset, 'landscapeLock') &&
    matchMedia('(orientation: portrait)').matches
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page: nothing outside this function is there
  const flipped = () =>
    Object.hasOwn(document.documentElement.dataset, 'landscapeFlip')
  // A screen box in the page's axes: turned clockwise the page's y runs from the screen's right edge, flipped from its
  // left; its x down the screen (flipped: up from the page's end)
  const inPage = (r: DOMRect): PageBox => {
    if (!turned()) {
      return { bottom: r.bottom, left: r.left, right: r.right, top: r.top }
    }
    if (flipped()) {
      const end = document.body.getBoundingClientRect().bottom
      return {
        bottom: r.right,
        left: end - r.bottom,
        right: end - r.top,
        top: r.left,
      }
    }
    return {
      bottom: innerWidth - r.left,
      left: r.top,
      right: r.bottom,
      top: innerWidth - r.right,
    }
  }
  const union = (boxes: PageBox[]): PageBox | null =>
    boxes.length === 0
      ? null
      : {
          bottom: Math.max(...boxes.map((b) => b.bottom)),
          left: Math.min(...boxes.map((b) => b.left)),
          right: Math.max(...boxes.map((b) => b.right)),
          top: Math.min(...boxes.map((b) => b.top)),
        }
  const range = document.createRange()
  // What is drawn: the glyph boxes of an element's text, transforms included
  const glyphs = (element: Element | null): PageBox | null => {
    if (element === null) {
      return null
    }
    range.selectNodeContents(element)
    return union(
      [...range.getClientRects()]
        .filter((r) => r.width > 1 && r.height > 1)
        .map(inPage)
    )
  }
  const boxOf = (element: Element | null): PageBox | null => {
    const r = element?.getBoundingClientRect()
    return r && r.height > 0 ? inPage(r) : null
  }
  const within = (box: PageBox | null, layer: PageBox): PageBox | null =>
    box === null
      ? null
      : {
          bottom: box.bottom - layer.top,
          left: box.left - layer.left,
          right: box.right - layer.left,
          top: box.top - layer.top,
        }
  const measure = () => {
    const layerElement = document.querySelector('[data-lyric-layer]')
    const layer = boxOf(layerElement) ?? {
      bottom: 0,
      left: 0,
      right: 0,
      top: 0,
    }
    const rowElements = [
      ...document.querySelectorAll('[data-lyric-rows-area] [data-lyric-row]'),
    ]
    const rows = rowElements.map((row) => within(glyphs(row), layer))
    const present = rows.filter((row): row is PageBox => row !== null)
    const docked = document.querySelector('[data-docked-translation="docked"]')
    const own = document.querySelector(
      '[data-lyric-translation] [data-lyrics-style-toggle]'
    )
    const text =
      docked === null
        ? glyphs(own)
        : glyphs(docked.querySelector('.docked-translation-text'))
    return {
      block: within(
        boxOf(
          document.querySelector(
            '[data-lyric-rows-area] [data-lyrics-style-toggle]'
          )
        ),
        layer
      ),
      docked: docked !== null,
      layer: {
        bottom: layer.bottom - layer.top,
        left: 0,
        right: layer.right - layer.left,
        top: 0,
      },
      rows,
      rowsText: union(present),
      slot: within(boxOf(docked), layer),
      translation: within(text, layer),
    }
  }
  let frames: ReturnType<typeof measure>[] = []
  let running = false
  const loop = () => {
    if (!running) {
      return
    }
    // A frame caught mid-remount can't be measured; the next one can
    try {
      frames.push(measure())
    } finally {
      requestAnimationFrame(loop)
    }
  }
  window.__undockMeter = {
    measure,
    start: () => {
      frames = []
      running = true
      requestAnimationFrame(loop)
    },
    stop: () => {
      running = false
      return frames
    },
    turned,
  }
}

const measure = async (page: Page): Promise<Frame> =>
  await page.evaluate(() => {
    if (window.__undockMeter === undefined) {
      throw new Error('no meter in the page')
    }
    return window.__undockMeter.measure()
  })
const record = async (page: Page) => {
  await page.evaluate(() => {
    window.__undockMeter?.start()
  })
}
const recorded = async (page: Page): Promise<Frame[]> =>
  await page.evaluate(() => window.__undockMeter?.stop() ?? [])

/**
 * A press on drawn text the element itself receives, then a drag by `dy` down the page in STEPS moves, a frame apart.
 * On a page turned by Lock Landscape the page's down is the screen's left. When no drawn point of it takes a press
 * (the stage's input layer over it, on a touch screen), the same drag is dispatched on it as pointer events
 */
const dragBy = async (page: Page, selector: string, dy: number) => {
  const start = await page.evaluate((sel) => {
    const handle = document.querySelector(sel)
    if (!handle) {
      return null
    }
    const turned = window.__undockMeter?.turned() ?? false
    for (const part of handle.querySelectorAll('span, ruby')) {
      const r = part.getBoundingClientRect()
      if (r.width >= 4 && r.height >= 4) {
        const x = r.left + r.width / 2
        const y = r.top + r.height / 2
        const hit = document.elementFromPoint(x, y)
        if (hit && handle.contains(hit)) {
          return { dispatch: false, turned, x, y }
        }
      }
    }
    const r = handle.getBoundingClientRect()
    return {
      dispatch: true,
      turned,
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    }
  }, selector)
  if (start === null) {
    throw new Error(`nothing matches ${selector} to drag`)
  }
  // Down the page: down the screen, or, turned clockwise, towards the screen's left
  const at = (by: number) =>
    start.turned
      ? { x: start.x - by, y: start.y }
      : { x: start.x, y: start.y + by }
  if (!start.dispatch) {
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    for (let step = 1; step <= STEPS; step += 1) {
      const point = at((dy * step) / STEPS)
      // oxlint-disable-next-line eslint/no-await-in-loop -- one move a frame, as a hand drags
      await page.mouse.move(point.x, point.y)
      // oxlint-disable-next-line eslint/no-await-in-loop -- the frame between moves
      await page.waitForTimeout(16)
    }
    await page.mouse.up()
    return
  }
  const fire = async (kind: string, point: { x: number; y: number }) => {
    await page.evaluate(
      ({ sel, type, x, y }) => {
        document.querySelector(sel)?.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            buttons: type === 'pointerup' ? 0 : 1,
            cancelable: true,
            clientX: x,
            clientY: y,
            isPrimary: true,
            pointerId: 1,
            pointerType: 'mouse',
          })
        )
      },
      { sel: selector, type: kind, x: point.x, y: point.y }
    )
  }
  await fire('pointerdown', at(0))
  for (let step = 1; step <= STEPS; step += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one move a frame, as a hand drags
    await fire('pointermove', at((dy * step) / STEPS))
    // oxlint-disable-next-line eslint/no-await-in-loop -- the frame between moves
    await page.waitForTimeout(16)
  }
  await fire('pointerup', at(dy))
}

/** A drag recorded on every frame, from the press until its places have come to rest */
const recordedDrag = async (page: Page, selector: string, dy: number) => {
  await record(page)
  await dragBy(page, selector, dy)
  await page.waitForTimeout(SETTLE_MS)
  return await recorded(page)
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
}

/** The player with Karaoke Style's rows on the stage and the translation docked, paused so the lines hold */
const dockedPage = async (
  surface: Surface,
  turned: boolean,
  url: string,
  size: string | null
) => {
  const player = LAYOUT_PAGES.find((p) => p.name === 'player')
  if (player === undefined) {
    throw new Error('no player page in LAYOUT_PAGES')
  }
  const opened = await open(surface)
  const prefs: Record<string, string> =
    size === null ? KARAOKE : { ...KARAOKE, lyricsFontSizeTwoLines: size }
  await opened.context.addInitScript((stored) => {
    for (const [key, value] of Object.entries(stored)) {
      localStorage.setItem(key, value)
    }
  }, prefs)
  await opened.context.addInitScript(installMeter)
  const { page } = opened
  try {
    await page.goto(url, { waitUntil: 'commit' })
    await player.ready(page)
    if (turned) {
      await turnPage(page)
    }
    for (let skips = 0; skips < 8; skips += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one look, then a press
      if ((await page.locator('[data-lyric-row]').count()) === 2) {
        break
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- the player skips 5 s a press
      await page.keyboard.press('ArrowRight')
      // oxlint-disable-next-line eslint/no-await-in-loop -- the rows settle
      await page.waitForTimeout(1200)
    }
    if ((await page.locator('[data-lyric-row]').count()) !== 2) {
      throw new Error("Karaoke Style's two rows never showed")
    }
    await page.keyboard.press('k')
    await page.waitForTimeout(800)
    if ((await page.locator(DOCKED_TEXT).count()) !== 1) {
      throw new Error('the docked translation never showed')
    }
    return opened
  } catch (error) {
    await opened.close()
    throw error
  }
}

const px = (value: number) => Math.round(value)
const overlapOf = (a: Box | null, b: Box | null) =>
  a === null || b === null
    ? 0
    : Math.max(
        0,
        Math.min(
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
          Math.min(a.right, b.right) - Math.max(a.left, b.left)
        )
      )

/** How far each of the rows' lines moved from `from`, the most of any edge; down positive, for the note */
const rowsMove = (frame: Frame, from: Frame) => {
  let most = 0
  let down = 0
  for (const [index, was] of from.rows.entries()) {
    const now = frame.rows[index]
    if (was === null || now === null || now === undefined) {
      continue
    }
    for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
      const moved = Math.abs(now[edge] - was[edge])
      if (moved > most) {
        most = moved
        down = now.top - was.top
      }
    }
  }
  return { down, most }
}

interface Tally {
  undockRowsMoved: number
  undockOverlap: number
  undockRefused: number
  undockEndedInside: number
  redockRowsMoved: number
  redockFailed: number
  rowsMovedMaxPx: number
  overlapMaxPx: number
}

/**
 * One drag's frames judged against the rows' place before it (`from`) and the block's area (`area`: the rows' lines
 * and the docked translation's place, as they were docked). Adds to the tally and the notes; returns its last frame
 */
const judge = (
  frames: Frame[],
  from: Frame,
  area: Box,
  what: string,
  tally: Tally,
  notes: string[],
  moved: 'undockRowsMoved' | 'redockRowsMoved'
) => {
  let worst = { down: 0, frame: -1, most: 0 }
  let overlap = { frame: -1, px: 0, with: '' }
  for (const [index, frame] of frames.entries()) {
    const move = rowsMove(frame, from)
    if (move.most > worst.most) {
      worst = { ...move, frame: index }
    }
    const onRows = overlapOf(frame.translation, frame.rowsText)
    // Off the rows, the translation keeps out of the whole block, the place it docked in included
    const onBlock = frame.docked ? 0 : overlapOf(frame.translation, area)
    const most = Math.max(onRows, onBlock)
    if (most > overlap.px) {
      overlap = {
        frame: index,
        px: most,
        with: onRows >= onBlock ? "the rows' lines" : "the block's area",
      }
    }
  }
  tally.rowsMovedMaxPx = Math.max(tally.rowsMovedMaxPx, px(worst.most))
  tally.overlapMaxPx = Math.max(tally.overlapMaxPx, px(overlap.px))
  if (worst.most > MOVED_PX) {
    tally[moved] += 1
    notes.push(
      `${what}: the rows' lines moved ${px(worst.most)}px (${worst.down >= 0 ? 'toward the bottom' : 'toward the top'} by ${px(Math.abs(worst.down))}px), frame ${worst.frame + 1} of ${frames.length}`
    )
  }
  if (overlap.px > OVERLAP_PX) {
    tally.undockOverlap += 1
    notes.push(
      `${what}: the translation overlapped ${overlap.with} by ${px(overlap.px)}px, frame ${overlap.frame + 1} of ${frames.length}`
    )
  }
  return frames.at(-1) ?? null
}

type Target = 'bottom' | 'top' | 'below' | 'inside'
const TARGETS: Target[] = ['bottom', 'top', 'below', 'inside']

/** How far to pull the docked translation's text for each target, down the page */
const pullFor = (target: Target, at: Frame, area: Box) => {
  const text = at.translation
  const rows = at.rowsText
  if (text === null || rows === null) {
    return 0
  }
  const stage = at.layer.bottom
  // A pull shorter than this springs back (stage-lyrics › pullToTear)
  const tear = Math.max(40, 0.1 * stage) + 8
  switch (target) {
    case 'bottom': {
      return stage - text.top + 200
    }
    case 'top': {
      return -(text.bottom + 200)
    }
    case 'below': {
      return Math.max(area.bottom + 6 - text.top, tear)
    }
    case 'inside': {
      return (rows.top + rows.bottom) / 2 - (text.top + text.bottom) / 2
    }
    default: {
      return 0
    }
  }
}

const TARGET_NAMES: Record<Target, string> = {
  below: 'place just under the block',
  bottom: 'bottom',
  inside: 'rows (inside the block)',
  top: 'top',
}

/** Where the translation was let go, judged: inside the block it must not stay; to an edge with room it must come off */
const judgeEnd = (
  target: Target,
  end: Frame,
  from: Frame,
  area: Box,
  what: string,
  tally: Tally,
  notes: string[]
) => {
  if (target === 'inside') {
    if (!end.docked && overlapOf(end.translation, area) > OVERLAP_PX) {
      tally.undockEndedInside += 1
      notes.push(
        `${what}: let go inside the block, it stayed there on its own (translation ${JSON.stringify(end.translation)}, block area ${JSON.stringify(area)})`
      )
    }
    return
  }
  if (!end.docked || target === 'below' || from.slot === null) {
    return
  }
  // Room on that side for the translation (half again its docked height, for the gap and its own room's height)
  const room =
    target === 'bottom'
      ? from.layer.bottom - area.bottom
      : area.top - from.layer.top
  if (room >= (from.slot.bottom - from.slot.top) * 1.5) {
    tally.undockRefused += 1
    notes.push(
      `${what}: it stayed docked, with ${px(room)}px free on that side`
    )
  }
}

/** One target from the docked block: pulled off there, then, if it came off, dragged back onto the block */
const undockOnce = async (
  page: Page,
  target: Target,
  label: string,
  tally: Tally,
  notes: string[]
) => {
  const what = `${label}, translation pulled to the ${TARGET_NAMES[target]}`
  const from = await measure(page)
  if (!from.docked || from.slot === null || from.rowsText === null) {
    notes.push(`${what}: not run, the translation wasn't docked to begin with`)
    return
  }
  const area: Box = {
    bottom: from.slot.bottom,
    left: Math.min(from.rowsText.left, from.slot.left),
    right: Math.max(from.rowsText.right, from.slot.right),
    top: from.rowsText.top,
  }
  const frames = await recordedDrag(
    page,
    DOCKED_TEXT,
    pullFor(target, from, area)
  )
  const end = judge(frames, from, area, what, tally, notes, 'undockRowsMoved')
  if (end === null) {
    return
  }
  judgeEnd(target, end, from, area, what, tally, notes)
  if (end.docked) {
    return
  }
  // Back onto the block: its centre onto the rows' lines
  const off = await measure(page)
  if (off.translation === null || off.rowsText === null) {
    return
  }
  const back = await recordedDrag(
    page,
    TRANSLATION,
    (off.rowsText.top + off.rowsText.bottom) / 2 -
      (off.translation.top + off.translation.bottom) / 2
  )
  const again = `${what}, then dragged back onto the block`
  const last = judge(back, from, area, again, tally, notes, 'redockRowsMoved')
  if (last?.docked !== true) {
    tally.redockFailed += 1
    notes.push(
      `${again}: it didn't dock (translation ${JSON.stringify(last?.translation)})`
    )
  }
}

/** The owner's case in one view at one size: the docked block to the middle of the stage, then each target and back */
const undockAtSize = async (
  surface: Surface,
  turned: boolean,
  url: string,
  size: (typeof SIZES)[number],
  tally: Tally,
  notes: string[],
  shot: string
) => {
  const { page, close } = await dockedPage(surface, turned, url, size.pref)
  try {
    const first = await measure(page)
    if (first.block === null) {
      throw new Error("the rows' block isn't drawn")
    }
    await dragBy(
      page,
      ROWS,
      first.layer.bottom / 2 - (first.block.top + first.block.bottom) / 2
    )
    await page.waitForTimeout(SETTLE_MS)
    for (const target of TARGETS) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one drag at a time, each from where the last left things
      await undockOnce(page, target, size.label, tally, notes)
    }
    await page.screenshot({ path: shot })
  } finally {
    await close()
  }
}

const undockAudit = async (
  surface: Surface,
  turned: boolean,
  url: string,
  artifactDir: string
): Promise<{ samples: Sample[]; errors: string[] }> => {
  const tally: Tally = {
    overlapMaxPx: 0,
    redockFailed: 0,
    redockRowsMoved: 0,
    rowsMovedMaxPx: 0,
    undockEndedInside: 0,
    undockOverlap: 0,
    undockRefused: 0,
    undockRowsMoved: 0,
  }
  const notes: string[] = []
  for (const [index, size] of SIZES.entries()) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one page at a time
    await undockAtSize(
      surface,
      turned,
      url,
      size,
      tally,
      notes,
      path.join(artifactDir, `screen-${index}.png`)
    )
  }
  return { errors: [], samples: [{ notes, values: { ...tally } }] }
}

/** The docked translation taken off and put back in one view; `turned`: an upright phone turned by Lock Landscape */
export const lyricUndockAudit =
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
            errors: [`lyric undock audit stuck for ${LIMIT_MS / 1000}s`],
            samples: [],
          })
        }, LIMIT_MS)
      }
    )
    try {
      return await Promise.race([
        undockAudit(
          surface,
          turned,
          `${ctx.origin}/v/${PLAYER_SONG}`,
          ctx.artifactDir
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
