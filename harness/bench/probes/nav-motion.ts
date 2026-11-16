// Page changes on a phone, frame by frame (the installed app: WebKit, 390×844). src/lib/nav/app-router.tsx runs each
// page change as a view transition of the kind src/lib/nav/transition-kind.ts picks, and src/globals.css ›
// html[data-nav] draws it. The audit warms the pages' code, then records three changes: You → About by a tap
// (`push`), Back (`pop`, history.back() in the page) and You → Search by a tap on the tab (`fade`).
//
// What it reads. Headless WebKit never draws the incoming side of a named snapshot in a screenshot, so nothing here
// looks at pixels. An init script wraps document.startViewTransition (as probes/theater-motion.ts does) and, every
// animation frame, reads the computed styles of the snapshots that draw the screen: ::view-transition-group(name)
// (box, opacity) and ::view-transition-old/new(name) (display, opacity, transform) for the page (`nav-page`), each
// bar (`nav-scrim`, `nav-topbar`, `nav-dock`, `nav-generation`) and `root`. A frame with no root group is the page
// itself: the bars' own boxes are read then. Never document.getAnimations(): it crashes this WebKit's page while a
// view transition runs.
//
// The frame clock is document.timeline.currentTime, the time the browser samples the animations at, so a frame's
// offset is an exact function of it (the same offsets came back at the same times in every run).
//
// Rules (AGENTS.md › Motion), each counting the things that broke it at least once:
// - teleports: no step between two frames is longer than the curve allows for the time between them:
//   travel × `maxEasedStep` (the largest change the easing makes over that share of the duration, the gap plus
//   CLOCK_MS) + NOISE_PX. At 60 Hz the slide's curve moves at most 18.1% of the travel in a frame, 20.2% with
//   CLOCK_MS: a budget of 79px for the page on top (390px wide) and 24px for the one under it. A late frame is
//   judged against its own, longer gap, so a dropped frame is allowed exactly the distance the curve covers
//   meanwhile. The first frame is judged as a step from where the page rests. A fade's opacity is judged the same
//   way (at most 0.18 a frame at 60 Hz, + OPACITY_NOISE).
// - offPath: the page on top moves one way only (within NOISE_PX), stays between its ends, moves only sideways and is
//   never scaled; the page under it the same, within 30% of the width.
// - offEnds: the last frame draws both pages where they end, within NOISE_PX (push: the top page at 0; pop: the page
//   under it at 0). A fade ends with the new page opaque.
// - opacityDips: both pages stay opaque through a slide (within OPACITY_NOISE), so one never shows through the other.
// - barMoves: a bar on both pages holds still as itself: its box is the same in every frame from before the change
//   to after it (within NOISE_PX), its old copy is not drawn, and its new one is opaque and unmoved.
// - wrongKind: one view transition ran, of the expected kind; html[data-nav] names it in every frame it is drawn
//   and is gone in the frames after.
// - durationOff: a slide's snapshots are taken down in the first frame at or after SLIDE_MS on the animations'
//   clock, so SLIDE_MS lies between the last two frames' times (within CLOCK_MS). A dropped frame widens that
//   bracket and never fails it. A fade's end can't be seen that way (opacity creeps to 1), so its new page's opacity
//   is held to the FADE_MS ease-out curve in every frame, within what the curve moves in CLOCK_MS + 0.01.
// - fadeExtras: in a fade only the root cross-fades: no page or bar snapshot exists.
//
// CLOCK_MS: this WebKit reports the timeline in whole milliseconds, so a gap between two frames is off by up to 1ms
// and so is a time since the first frame; 2ms covers both.
//
// Stalls, as in probes/motion.ts: a step over its budget across a stalled frame (over `stallLimit`: 50ms, or three
// median frames) is the machine's, not counted; the three changes are recorded again, up to REDOS times, and each is
// judged on its first recording where no stall hid a jump. Stalled on every attempt is no sample (`machine stalled`).
//
// Reported, not judged: each change's length, the largest step as a share of its budget, how long a fade's snapshots
// stay up (`fadeHeldMs`), dropped and stalled frames, redos. SLIDE_MS, SLIDE_EASE, UNDER_SHARE, FADE_MS and FADE_EASE
// repeat globals.css: a retuned transition changes them here, in its own PR.

import { writeFileSync } from 'node:fs'
import path from 'node:path'

import type { Page } from 'playwright'

import { PWA_PORTRAIT, open } from '../engines/browser'
import type { BenchContext, Sample } from '../types'
import { pageAt } from './layout'
import { REDOS, stallLimit, stallText } from './motion'
import type { Stall } from './motion'

/** A cubic-bezier easing's control points, as CSS writes them */
export type Curve = readonly [number, number, number, number]

export const SLIDE_MS = 380
export const SLIDE_EASE: Curve = [0.32, 0.72, 0, 1]
/** How far the page under the top one travels, as a share of the width */
export const UNDER_SHARE = 0.3
export const FADE_MS = 150
/** CSS `ease-out` */
export const FADE_EASE: Curve = [0, 0, 0.58, 1]

const NOISE_PX = 0.5
const OPACITY_NOISE = 0.01
const CLOCK_MS = 2
/** A fade's opacity this close to its end is there */
const FADED = 0.001
const VSYNC_MS = 1000 / 60
const LIMIT_MS = 120_000
/** Frames of the page itself recorded after the transition, where html[data-nav] must be gone */
const AFTER_FRAMES = 6
/** Frames in a row with the page and its bars unmoved before the next change is driven */
const REST_FRAMES = 12
const MAX_RECORD_MS = 3000
const NOTES_PER_RULE = 4

const PAGE = 'nav-page'
/** The bars the page slides under, by their view-transition-name (globals.css › html[data-nav]) */
const BARS: Record<string, string> = {
  'nav-dock': '[data-tabbar-root]',
  'nav-generation': '[data-generation-host]',
  'nav-scrim': '[data-status-scrim]',
  'nav-topbar': '[data-topbar]',
}

export const NAV_MOTION_FINDINGS = [
  'teleports',
  'offPath',
  'offEnds',
  'opacityDips',
  'barMoves',
  'wrongKind',
  'durationOff',
  'fadeExtras',
] as const
export type NavRule = (typeof NAV_MOTION_FINDINGS)[number]
export type SlideKind = 'push' | 'pop'
export type Kind = SlideKind | 'fade'

/** One snapshot of a named part: how it is displayed, how opaque, and where its transform puts it */
export interface Side {
  d: string
  o: number
  x: number
  y: number
  /** Its transform does more than move it */
  k: boolean
}
/** A named part in one frame: its group's box (left, top, width, height) and opacity, and its two snapshots */
export interface Named {
  box: [number, number, number, number]
  o: number
  k: boolean
  /** Null in a frame of the page itself, where `box` is the element's own */
  old: Side | null
  new: Side | null
}
export interface Frame {
  /** performance.now(), for frame gaps and stalls */
  t: number
  /** document.timeline.currentTime: the time the animations were sampled at */
  tl: number
  nav: string | null
  /** The transition's snapshots draw the screen */
  drawn: boolean
  /** A transition was asked for and its snapshots aren't drawn yet: the screen holds the old page */
  held: boolean
  page: Named | null
  bars: Record<string, Named | null>
  root: { old: number; new: number } | null
}
export interface Transition {
  /** html[data-nav] when the transition was asked for */
  kind: string | null
  /** The bars rendered on the old page, and on the new one */
  had: string[]
  has: string[]
  done: boolean
}
export interface Recorded {
  frames: Frame[]
  transitions: Transition[]
  /** What popstate said of the browser having drawn the change itself (`hasUAVisualTransition`), if one fired */
  back: boolean | 'missing' | null
}

interface PageRecorder extends Recorded {
  recording: boolean
  error: string | null
  start: (after: number, maxMs: number) => void
}

declare global {
  interface Window {
    __nav?: PageRecorder
  }
}

/* oxlint-disable unicorn/consistent-function-scoping -- the recorder runs in the page: nothing outside it is there */
/** Installed before any page script: wraps startViewTransition to learn each transition's kind, and reads frames */
const installRecorder = ({
  bars,
  pageName,
}: {
  bars: Record<string, string>
  pageName: string
}) => {
  const recorder: PageRecorder = {
    back: null,
    error: null,
    frames: [],
    recording: false,
    start: () => {
      // Replaced below
    },
    transitions: [],
  }
  window.__nav = recorder
  const rendered = () =>
    Object.entries(bars)
      .filter(
        ([, selector]) =>
          (document.querySelector(selector)?.getClientRects().length ?? 0) > 0
      )
      .map(([name]) => name)
  window.addEventListener(
    'popstate',
    (event) => {
      const told: unknown =
        'hasUAVisualTransition' in event
          ? event.hasUAVisualTransition
          : undefined
      recorder.back = typeof told === 'boolean' ? told : 'missing'
    },
    { capture: true }
  )
  if (typeof document.startViewTransition === 'function') {
    const original = document.startViewTransition.bind(document)
    document.startViewTransition = (
      update?: Parameters<Document['startViewTransition']>[0]
    ) => {
      const entry: Transition = {
        done: false,
        had: rendered(),
        has: [],
        kind: document.documentElement.dataset.nav ?? null,
      }
      recorder.transitions.push(entry)
      const transition = original(update)
      const follow = async () => {
        try {
          await transition.ready
          entry.has = rendered()
          await transition.finished
        } catch {
          // A skipped transition: the frames show it was never drawn
        } finally {
          entry.done = true
        }
      }
      void follow()
      return transition
    }
  }

  const pseudo = (kind: string, name: string) =>
    getComputedStyle(
      document.documentElement,
      `::view-transition-${kind}(${name})`
    )
  const matrix = (transform: string) => {
    const m = new DOMMatrix(transform === 'none' ? undefined : transform)
    return {
      k: !(m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1),
      x: m.e,
      y: m.f,
    }
  }
  const side = (kind: 'old' | 'new', name: string): Side => {
    const s = pseudo(kind, name)
    return { d: s.display, o: Number(s.opacity), ...matrix(s.transform) }
  }
  // "auto" while no such group is drawn
  const named = (name: string): Named | null => {
    const g = pseudo('group', name)
    const width = Number(g.width.replace('px', ''))
    const height = Number(g.height.replace('px', ''))
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return null
    }
    const { x, y, k } = matrix(g.transform)
    return {
      box: [x, y, width, height],
      k,
      new: side('new', name),
      o: Number(g.opacity),
      old: side('old', name),
    }
  }
  const element = (selector: string): Named | null => {
    const el = document.querySelector(selector)
    if (el === null || el.getClientRects().length === 0) {
      return null
    }
    const r = el.getBoundingClientRect()
    return {
      box: [r.left, r.top, r.width, r.height],
      k: false,
      new: null,
      o: 1,
      old: null,
    }
  }
  const read = (): Frame => {
    const drawn = named('root') !== null
    const frame: Frame = {
      bars: {},
      drawn,
      held: !drawn && recorder.transitions.some((t) => !t.done),
      nav: document.documentElement.dataset.nav ?? null,
      page: drawn ? named(pageName) : null,
      root: drawn
        ? {
            new: Number(pseudo('new', 'root').opacity),
            old: Number(pseudo('old', 'root').opacity),
          }
        : null,
      t: performance.now(),
      tl: Number(document.timeline.currentTime ?? performance.now()),
    }
    for (const [name, selector] of Object.entries(bars)) {
      frame.bars[name] = drawn ? named(name) : element(selector)
    }
    return frame
  }

  recorder.start = (after, maxMs) => {
    recorder.frames = []
    recorder.transitions = []
    recorder.back = null
    recorder.error = null
    recorder.recording = true
    const startedAt = performance.now()
    let rest = 0
    const tick = () => {
      let frame: Frame
      try {
        frame = read()
      } catch (error) {
        recorder.error = String(error)
        recorder.recording = false
        return
      }
      recorder.frames.push(frame)
      const over =
        recorder.transitions.length > 0 &&
        recorder.transitions.every((t) => t.done)
      rest = over && !frame.drawn ? rest + 1 : 0
      if (rest >= after || performance.now() - startedAt > maxMs) {
        recorder.recording = false
      } else {
        requestAnimationFrame(tick)
      }
    }
    requestAnimationFrame(tick)
  }
}
/* oxlint-enable unicorn/consistent-function-scoping */

/** Records every frame from a little before `act` until AFTER_FRAMES frames after its transition, or MAX_RECORD_MS */
const record = async (
  page: Page,
  act: () => Promise<void>
): Promise<Recorded> => {
  await page.evaluate(
    ({ after, maxMs }) => {
      window.__nav?.start(after, maxMs)
    },
    { after: AFTER_FRAMES, maxMs: MAX_RECORD_MS }
  )
  // A few frames of rest first: where the bars sit before the change
  await page.waitForTimeout(100)
  await act()
  // Polled on a timer, not on animation frames (engines/browser.ts › mark)
  await page.waitForFunction(() => window.__nav?.recording === false, null, {
    polling: 50,
    timeout: MAX_RECORD_MS + 5000,
  })
  const recorded = await page.evaluate(() => ({
    back: window.__nav?.back ?? null,
    error: window.__nav?.error ?? null,
    frames: window.__nav?.frames ?? [],
    transitions: window.__nav?.transitions ?? [],
  }))
  if (recorded.error !== null) {
    throw new Error(`a frame couldn't be read: ${recorded.error}`)
  }
  return {
    back: recorded.back,
    frames: recorded.frames,
    transitions: recorded.transitions,
  }
}

const along = (a: number, b: number, s: number) =>
  3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s

/** A cubic-bezier easing's output at `x` (0 to 1 of the duration) */
export const eased = ([x1, y1, x2, y2]: Curve, x: number): number => {
  if (x <= 0) {
    return 0
  }
  if (x >= 1) {
    return 1
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2
    if (along(x1, x2, mid) < x) {
      lo = mid
    } else {
      hi = mid
    }
  }
  return along(y1, y2, (lo + hi) / 2)
}

const steps = new Map<string, number>()
/** The largest change the easing makes over any stretch `share` of its duration long: the longest legal step */
export const maxEasedStep = (curve: Curve, share: number): number => {
  if (share >= 1) {
    return 1
  }
  const key = `${curve.join(',')}|${share.toFixed(4)}`
  const known = steps.get(key)
  if (known !== undefined) {
    return known
  }
  const SCAN = 1000
  let max = 0
  for (let i = 0; i <= SCAN; i += 1) {
    const x = (i / SCAN) * (1 - share)
    max = Math.max(max, eased(curve, x + share) - eased(curve, x))
  }
  steps.set(key, max)
  return max
}

export interface NavJudged {
  counts: Record<NavRule, number>
  notes: string[]
  /** Steps over budget across stalled frames, not counted: the change is recorded again. Null when none */
  stall: Stall | null
  stalledFrames: number
  dropped: number
  /** From the first drawn frame to the one that ends it (a fade: to the new page opaque), on the animations' clock */
  ms: number
  /** From the first drawn frame to the last: how long the snapshots stay up */
  heldMs: number
  /** The worst margin seen for each rule that has one */
  worst: {
    /** The largest step over its budget (1 is at the budget) */
    stepShare: number
    endOffPx: number
    opacityMin: number
    barMovePx: number
    /** A fade's furthest from its curve, in opacity */
    offCurve: number
  }
}

/** One recorded change's findings, gathered rule by rule */
class Judgement {
  readonly out: NavJudged = {
    counts: {
      barMoves: 0,
      durationOff: 0,
      fadeExtras: 0,
      offEnds: 0,
      offPath: 0,
      opacityDips: 0,
      teleports: 0,
      wrongKind: 0,
    },
    dropped: 0,
    heldMs: 0,
    ms: 0,
    notes: [],
    stall: null,
    stalledFrames: 0,
    worst: {
      barMovePx: 0,
      endOffPx: 0,
      offCurve: 0,
      opacityMin: 1,
      stepShare: 0,
    },
  }
  readonly frames: Frame[]
  readonly limitMs: number
  private readonly kind: Kind
  private readonly broke = new Set<string>()
  private readonly noted: Partial<Record<NavRule, number>> = {}

  constructor(kind: Kind, frames: Frame[]) {
    this.kind = kind
    this.frames = frames
    this.limitMs = stallLimit(frames.map((f) => f.t))
  }

  /** `what` broke `rule`: counted once, noted the first few times */
  flag(rule: NavRule, what: string, text: string) {
    if (!this.broke.has(`${rule}|${what}`)) {
      this.broke.add(`${rule}|${what}`)
      this.out.counts[rule] += 1
    }
    const n = (this.noted[rule] ?? 0) + 1
    this.noted[rule] = n
    if (n <= NOTES_PER_RULE) {
      this.out.notes.push(`${this.kind}: ${rule}: ${text}`)
    }
  }

  /** Frame i's gap on the animations' clock; the first frame's is one refresh */
  gap(i: number): number {
    const prev = this.frames[i - 1]
    return prev === undefined ? VSYNC_MS : this.frames[i].tl - prev.tl
  }

  /**
   * A step of `size` into frame i against `budget`: a teleport when over, or, across a stalled frame (this gap or
   * the one before: what moved during a stall can show a frame late), the machine's
   */
  step(i: number, what: string, size: number, budget: number, text: string) {
    this.out.worst.stepShare = Math.max(this.out.worst.stepShare, size / budget)
    if (size <= budget) {
      return
    }
    const at = (j: number) =>
      (this.frames[j]?.t ?? 0) -
      (this.frames[j - 1]?.t ?? this.frames[j]?.t ?? 0)
    const gapMs = Math.max(at(i), at(i - 1))
    if (gapMs > this.limitMs) {
      const s = this.out.stall
      this.out.stall = {
        frame: i,
        gapMs: Math.max(gapMs, s?.gapMs ?? 0),
        hidden: (s?.hidden ?? 0) + 1,
        limitMs: this.limitMs,
      }
      return
    }
    this.flag('teleports', what, text)
  }

  done(): NavJudged {
    for (const [rule, n] of Object.entries(this.noted)) {
      if (n > NOTES_PER_RULE) {
        this.out.notes.push(
          `${this.kind}: ${rule}: ${n - NOTES_PER_RULE} more not listed`
        )
      }
    }
    return this.out
  }
}

const px = (n: number) => `${n.toFixed(1)}px`

/** One page's snapshot in one frame: between its ends, on its line, unscaled and opaque */
const judgeDrawn = (
  j: Judgement,
  { i, name, which }: { i: number; name: string; which: string },
  s: Side,
  [lowest, highest]: [number, number]
) => {
  if (s.x < lowest - NOISE_PX || s.x > highest + NOISE_PX) {
    j.flag(
      'offPath',
      `${which} past`,
      `${name} is at ${px(s.x)} at frame ${i}, outside ${px(lowest)} to ${px(highest)}`
    )
  }
  if (Math.abs(s.y) > NOISE_PX || s.k) {
    j.flag(
      'offPath',
      `${which} shape`,
      `${name} is ${s.k ? 'scaled or turned' : `${px(s.y)} off its line`} at frame ${i}`
    )
  }
  j.out.worst.opacityMin = Math.min(j.out.worst.opacityMin, s.o)
  if (s.o < 1 - OPACITY_NOISE || s.d === 'none') {
    j.flag(
      'opacityDips',
      which,
      `${name} is ${s.d === 'none' ? 'not drawn' : `${s.o.toFixed(2)} opaque`} at frame ${i}`
    )
  }
}

/** One page of a slide, frame by frame: its steps, its way, its ends and its opacity */
const judgePage = (
  j: Judgement,
  kind: SlideKind,
  which: 'top' | 'under',
  [first, last]: [number, number],
  width: number
) => {
  const snapshot = (kind === 'push') === (which === 'top') ? 'new' : 'old'
  const travel = which === 'top' ? width : UNDER_SHARE * width
  const lowest = which === 'top' ? 0 : -travel
  const highest = lowest + travel
  // A push moves both pages left, a pop right
  const way = kind === 'push' ? -1 : 1
  const start = way < 0 ? highest : lowest
  const end = way < 0 ? lowest : highest
  const name = `the page ${which === 'top' ? 'on top' : 'underneath'}`
  let before = start
  for (let i = first; i <= last; i += 1) {
    const s = j.frames[i].page?.[snapshot]
    if (s === null || s === undefined) {
      continue
    }
    const gapMs = j.gap(i)
    const budget =
      travel * maxEasedStep(SLIDE_EASE, (gapMs + CLOCK_MS) / SLIDE_MS) +
      NOISE_PX
    j.step(
      i,
      which,
      Math.abs(s.x - before),
      budget,
      `${name} jumped ${px(Math.abs(s.x - before))} in one frame (frame ${i}: ${px(before)} → ${px(s.x)}, ${gapMs.toFixed(0)}ms after the one before; the curve allows ${px(budget)})`
    )
    if ((s.x - before) * way < -NOISE_PX) {
      j.flag(
        'offPath',
        `${which} back`,
        `${name} came back ${px(Math.abs(s.x - before))} at frame ${i} (${px(before)} → ${px(s.x)})`
      )
    }
    judgeDrawn(j, { i, name, which }, s, [lowest, highest])
    before = s.x
  }
  j.out.worst.endOffPx = Math.max(j.out.worst.endOffPx, Math.abs(before - end))
  if (Math.abs(before - end) > NOISE_PX) {
    j.flag(
      'offEnds',
      which,
      `${name} is at ${px(before)} in the last frame (frame ${last}), ${px(Math.abs(before - end))} from its end at ${px(end)}`
    )
  }
}

/** The furthest any side or size of a box is from another's */
const offset = (box: Named['box'], from: Named['box']) =>
  Math.max(...box.map((v, k) => Math.abs(v - (from[k] ?? v))))

/** What is wrong with a bar's new copy, which must be drawn, opaque and unmoved inside its box; null when nothing */
const barCopyOff = (bar: Named, copy: Side): string | null => {
  if (copy.d === 'none') {
    return 'not drawn'
  }
  const shift = Math.max(Math.abs(copy.x), Math.abs(copy.y))
  if (shift > NOISE_PX || copy.k) {
    return copy.k ? 'scaled or turned' : `moved ${px(shift)} inside its box`
  }
  const opacity = Math.min(bar.o, copy.o)
  return opacity < 1 - OPACITY_NOISE ? `${opacity.toFixed(2)} opaque` : null
}

/** A bar on both pages: the same box in every frame, its old copy not drawn, its new one opaque and unmoved */
const judgeBar = (j: Judgement, name: string) => {
  let rest: Named['box'] | null = null
  for (const [i, frame] of j.frames.entries()) {
    // While the screen holds the old page the document is already the new one: not what is drawn
    if (frame.held) {
      continue
    }
    const bar = frame.bars[name]
    if (bar === null || bar === undefined) {
      if (frame.drawn) {
        j.flag(
          'barMoves',
          `${name} gone`,
          `${name} has no snapshot at frame ${i}`
        )
      }
      continue
    }
    rest ??= bar.box
    const moved = offset(bar.box, rest)
    j.out.worst.barMovePx = Math.max(j.out.worst.barMovePx, moved)
    if (moved > NOISE_PX || bar.k) {
      j.flag(
        'barMoves',
        `${name} box`,
        `${name}'s box is ${bar.k ? 'scaled or turned' : `${px(moved)} from where it rested`} at frame ${i} (${bar.box.map((v) => v.toFixed(1)).join(', ')} against ${rest.map((v) => v.toFixed(1)).join(', ')})`
      )
    }
    if (bar.old !== null && bar.old.d !== 'none') {
      j.flag(
        'barMoves',
        `${name} old`,
        `${name}'s old copy is drawn at frame ${i} (${bar.old.o.toFixed(2)} opaque): a cross-fade with itself`
      )
    }
    const wrong = bar.new === null ? null : barCopyOff(bar, bar.new)
    if (wrong !== null) {
      j.flag('barMoves', `${name} new`, `${name} is ${wrong} at frame ${i}`)
    }
  }
}

const judgeSlide = (
  j: Judgement,
  kind: SlideKind,
  span: [number, number],
  transition: Transition | undefined
) => {
  const [first, last] = span
  const width = j.frames[first].page?.box[2]
  for (let i = first; i <= last; i += 1) {
    if (j.frames[i].page === null) {
      j.flag('wrongKind', 'page', `the page has no snapshot at frame ${i}`)
    }
  }
  if (width !== undefined) {
    judgePage(j, kind, 'top', span, width)
    judgePage(j, kind, 'under', span, width)
  }
  for (const name of Object.keys(BARS)) {
    if (
      transition?.had.includes(name) === true &&
      transition.has.includes(name)
    ) {
      judgeBar(j, name)
    }
  }
  // The snapshots are taken down in the first frame at or after the animations' end
  const t0 = j.frames[first].tl
  const before = (j.frames[last - 1]?.tl ?? t0) - t0
  j.out.ms = Math.round(j.frames[last].tl - t0)
  if (j.out.ms < SLIDE_MS - CLOCK_MS) {
    j.flag(
      'durationOff',
      'early',
      `over by ${j.out.ms}ms (frame ${last}), before its ${SLIDE_MS}ms`
    )
  }
  if (last - 1 > first && before > SLIDE_MS + CLOCK_MS) {
    j.flag(
      'durationOff',
      'late',
      `still running at ${before.toFixed(0)}ms (frame ${last - 1}), past its ${SLIDE_MS}ms`
    )
  }
}

const judgeFade = (j: Judgement, [first, last]: [number, number]) => {
  const t0 = j.frames[first].tl
  const tolerance = maxEasedStep(FADE_EASE, CLOCK_MS / FADE_MS) + OPACITY_NOISE
  let before = { new: 0, old: 1 }
  let faded: number | null = null
  for (let i = first; i <= last; i += 1) {
    const frame = j.frames[i]
    for (const [name, part] of [
      [PAGE, frame.page],
      ...Object.entries(frame.bars),
    ] as const) {
      if (part !== null) {
        j.flag(
          'fadeExtras',
          name,
          `${name} has a snapshot of its own at frame ${i}`
        )
      }
    }
    const { root } = frame
    if (root === null) {
      continue
    }
    const gapMs = j.gap(i)
    const budget =
      maxEasedStep(FADE_EASE, (gapMs + CLOCK_MS) / FADE_MS) + OPACITY_NOISE
    for (const side of ['new', 'old'] as const) {
      const change = root[side] - before[side]
      j.step(
        i,
        side,
        Math.abs(change),
        budget,
        `the ${side} page's opacity ${before[side].toFixed(2)} → ${root[side].toFixed(2)} in one frame (frame ${i}, ${gapMs.toFixed(0)}ms after the one before; the curve allows ${budget.toFixed(2)})`
      )
      if (change * (side === 'new' ? 1 : -1) < -OPACITY_NOISE) {
        j.flag(
          'offPath',
          side,
          `the ${side} page's opacity turned back at frame ${i} (${before[side].toFixed(2)} → ${root[side].toFixed(2)})`
        )
      }
    }
    const at = frame.tl - t0
    const due = eased(FADE_EASE, at / FADE_MS)
    j.out.worst.offCurve = Math.max(
      j.out.worst.offCurve,
      Math.abs(root.new - due)
    )
    if (Math.abs(root.new - due) > tolerance) {
      j.flag(
        'durationOff',
        'curve',
        `the new page is ${root.new.toFixed(2)} opaque at ${at.toFixed(0)}ms (frame ${i}); a ${FADE_MS}ms ease-out is at ${due.toFixed(2)}`
      )
    }
    if (faded === null && root.new >= 1 - FADED && root.old <= FADED) {
      faded = at
    }
    before = root
  }
  j.out.ms = Math.round(faded ?? j.frames[last].tl - t0)
  j.out.worst.endOffPx = 0
  if (before.new < 1 - OPACITY_NOISE || before.old > OPACITY_NOISE) {
    j.flag(
      'offEnds',
      'root',
      `the last frame (frame ${last}) draws the new page ${before.new.toFixed(2)} opaque and the old ${before.old.toFixed(2)}`
    )
  }
}

/** html[data-nav] names the kind in every frame the transition is drawn, which are in a row, and is gone after */
const judgeAttribute = (
  j: Judgement,
  kind: Kind,
  [first, last]: [number, number]
) => {
  for (const [i, frame] of j.frames.entries()) {
    if (i >= first && i <= last && frame.nav !== kind) {
      j.flag(
        'wrongKind',
        'during',
        `html[data-nav] is ${frame.nav ?? 'absent'} at frame ${i}, while the transition is drawn`
      )
    }
    if (i > last && frame.nav !== null) {
      j.flag(
        'wrongKind',
        'after',
        `html[data-nav="${frame.nav}"] is still set at frame ${i}, after the transition`
      )
    }
    if (i > first && i < last && !frame.drawn) {
      j.flag('wrongKind', 'gap', `frame ${i} draws no transition mid-way`)
    }
  }
}

/** One recorded page change against the rules above */
export const judgeNav = (kind: Kind, recorded: Recorded): NavJudged => {
  const { frames, transitions } = recorded
  const j = new Judgement(kind, frames)
  const { out } = j
  if (transitions.length !== 1) {
    j.flag(
      'wrongKind',
      'count',
      `${transitions.length} view transitions ran, not one`
    )
  }
  const [transition] = transitions
  if (transition !== undefined && transition.kind !== kind) {
    j.flag(
      'wrongKind',
      'kind',
      `the change ran as ${transition.kind ?? 'a transition with no html[data-nav]'}`
    )
  }
  const first = frames.findIndex((f) => f.drawn)
  const last = frames.findLastIndex((f) => f.drawn)
  if (first === -1) {
    j.flag('wrongKind', 'undrawn', 'no frame drew a view transition')
    return j.done()
  }
  for (const [i, frame] of frames.entries()) {
    const gapMs = frame.t - (frames[i - 1]?.t ?? frame.t)
    out.stalledFrames += gapMs > j.limitMs ? 1 : 0
    out.dropped += i > first && i <= last && gapMs > VSYNC_MS * 1.5 ? 1 : 0
  }
  judgeAttribute(j, kind, [first, last])
  out.heldMs = Math.round(frames[last].tl - frames[first].tl)
  if (kind === 'fade') {
    judgeFade(j, [first, last])
  } else {
    judgeSlide(j, kind, [first, last], transition)
  }
  return j.done()
}

const HOME = '/you'
/** The recorded changes, in order from HOME, each with something its page shows once it has rendered */
const PASSES: {
  kind: Kind
  to: string
  shows: string
  /** A link to tap, or Back */
  tap: string | null
}[] = [
  {
    kind: 'push',
    shows: '[data-page-content] h1',
    tap: '[data-page-content] a[href="/about"]',
    to: '/about',
  },
  {
    kind: 'pop',
    shows: '[data-page-content] a[href="/about"]',
    tap: null,
    to: HOME,
  },
  {
    kind: 'fade',
    shows: '[data-page-content] input',
    tap: '[data-tab-nav] a[href="/search"]',
    to: '/search',
  },
]
const TO_HOME = {
  shows: '[data-page-content] a[href="/about"]',
  tap: '[data-tab-nav] a[href="/you"]',
  to: HOME,
}

/** The page at `to` has rendered, no transition runs and the layout rests */
const arrived = async (page: Page, to: string, shows: string) => {
  await page.waitForFunction(
    ({ pathname, selector }) =>
      location.pathname === pathname &&
      document.documentElement.dataset.nav === undefined &&
      document.querySelector(selector) !== null &&
      document.querySelector('[aria-busy=true]') === null,
    { pathname: to, selector: shows },
    { polling: 50, timeout: 15_000 }
  )
  // Not the recorder's `settle`: it asks document.getAnimations(), which crashes this WebKit's page after a view
  // transition as it does during one. The bars, the page box and what the page shows unmoved for REST_FRAMES frames
  await page.evaluate(
    async ({ selectors, frames, limitMs }) => {
      const key = () =>
        selectors
          .map((selector) => {
            const r = document.querySelector(selector)?.getBoundingClientRect()
            return r === undefined
              ? '-'
              : [r.x, r.y, r.width, r.height].map(Math.round).join(',')
          })
          .join('|')
      const deadline = performance.now() + limitMs
      let before = ''
      let still = 0
      while (still < frames && performance.now() < deadline) {
        // One frame, or 100ms when WebKit holds frames back
        // oxlint-disable-next-line eslint/no-await-in-loop, promise/avoid-new -- frame after frame
        await new Promise((resolve) => {
          requestAnimationFrame(resolve)
          setTimeout(resolve, 100)
        })
        const now = key()
        still = now === before ? still + 1 : 0
        before = now
      }
    },
    {
      frames: REST_FRAMES,
      limitMs: 5000,
      selectors: [...Object.values(BARS), '[data-page-content]', shows],
    }
  )
}

const go = async (page: Page, tap: string | null) => {
  if (tap !== null) {
    await page.locator(tap).tap()
    return
  }
  // Back as the page's own script asks for it: popstate says the browser drew nothing itself
  await page.evaluate(() => {
    history.back()
  })
}

/** One run against any served copy (a dev server while working: `navRun('http://localhost:5173', dir)`) */
export const navRun = async (
  origin: string,
  artifactDir: string
): Promise<Sample> => {
  const { page, close } = await open(PWA_PORTRAIT.surface)
  try {
    await page.addInitScript(installRecorder, { bars: BARS, pageName: PAGE })
    await page.goto(`${origin}${HOME}`, { waitUntil: 'commit' })
    await pageAt(new URL(`${origin}${HOME}`)).ready(page)
    await arrived(page, HOME, TO_HOME.shows)
    // Every change once unrecorded, so no page's code or data loads inside a measured one
    for (const pass of [...PASSES, TO_HOME]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one page change after the other
      await go(page, pass.tap)
      // oxlint-disable-next-line eslint/no-await-in-loop -- one page change after the other
      await arrived(page, pass.to, pass.shows)
    }
    // All three, again while a stall hid a jump in one (probes/motion.ts › "stall"); each is judged on its first
    // recording where none did
    const attempts: Partial<Record<Kind, Recorded>>[] = []
    const kept: Partial<Record<Kind, NavJudged>> = {}
    const stalls: string[] = []
    let stalledFrames = 0
    for (
      let attempt = 0;
      attempt <= REDOS && PASSES.some((p) => kept[p.kind] === undefined);
      attempt += 1
    ) {
      const recordings: Partial<Record<Kind, Recorded>> = {}
      attempts.push(recordings)
      for (const pass of PASSES) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one page change after the other
        const recorded = await record(page, async () => {
          await go(page, pass.tap)
        })
        recordings[pass.kind] = recorded
        // oxlint-disable-next-line eslint/no-await-in-loop -- one page change after the other
        await arrived(page, pass.to, pass.shows)
        const judged = judgeNav(pass.kind, recorded)
        stalledFrames += judged.stalledFrames
        if (judged.stall === null) {
          kept[pass.kind] ??= judged
        } else {
          stalls.push(
            `${pass.kind}, attempt ${attempt + 1}: run again: ${stallText(judged.stall)}`
          )
        }
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- one page change after the other
      await go(page, TO_HOME.tap)
      // oxlint-disable-next-line eslint/no-await-in-loop -- one page change after the other
      await arrived(page, TO_HOME.to, TO_HOME.shows)
    }
    writeFileSync(
      path.join(artifactDir, 'frames.json'),
      JSON.stringify(
        attempts.length === 1 ? attempts[0] : { attempts },
        null,
        1
      )
    )
    const { push, pop, fade } = kept
    if (push === undefined || pop === undefined || fade === undefined) {
      const missing = PASSES.find((p) => kept[p.kind] === undefined)
      throw new Error(
        `machine stalled: ${missing?.kind ?? 'a change'} stalled on all ${REDOS + 1} attempts (last: ${stalls.at(-1) ?? 'unknown'})`
      )
    }
    const judged = [push, pop, fade]
    const counts = Object.fromEntries(
      NAV_MOTION_FINDINGS.map((rule) => [
        rule,
        judged.reduce((n, j) => n + j.counts[rule], 0),
      ])
    )
    return {
      notes: [...stalls, ...judged.flatMap((j) => j.notes)],
      values: {
        ...counts,
        barMoveMaxPx: Math.max(push.worst.barMovePx, pop.worst.barMovePx),
        droppedFrames: judged.reduce((n, j) => n + j.dropped, 0),
        endOffMaxPx: Math.max(push.worst.endOffPx, pop.worst.endOffPx),
        fadeHeldMs: fade.heldMs,
        fadeMs: fade.ms,
        fadeOffCurvePct: Math.round(fade.worst.offCurve * 1000) / 10,
        frames: attempts.reduce(
          (n, a) =>
            n + Object.values(a).reduce((m, r) => m + r.frames.length, 0),
          0
        ),
        opacityMinPct:
          Math.round(
            Math.min(push.worst.opacityMin, pop.worst.opacityMin) * 1000
          ) / 10,
        popMs: pop.ms,
        pushMs: push.ms,
        redos: attempts.length - 1,
        stalledFrames,
        stepBudgetPct: Math.round(
          Math.max(...judged.map((j) => j.worst.stepShare)) * 100
        ),
      },
    }
  } finally {
    await close()
  }
}

/** The page slide and the tab fade in the installed app, every frame */
export const navMotionAudit = async (
  ctx: BenchContext
): Promise<{ samples: Sample[]; errors: string[] }> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  // oxlint-disable-next-line promise/avoid-new -- settles when the limit passes
  const stuck = new Promise<{ samples: Sample[]; errors: string[] }>(
    (resolve) => {
      timer = setTimeout(() => {
        resolve({
          errors: [`nav motion audit stuck for ${LIMIT_MS / 1000}s`],
          samples: [],
        })
      }, LIMIT_MS)
    }
  )
  try {
    return await Promise.race([
      navRun(ctx.origin, ctx.artifactDir).then(
        (sample) => ({ errors: [], samples: [sample] }),
        (error: unknown) => ({
          errors: [
            (error instanceof Error ? error.message : String(error)).split(
              '\n'
            )[0],
          ],
          samples: [],
        })
      ),
      stuck,
    ])
  } finally {
    clearTimeout(timer)
  }
}
