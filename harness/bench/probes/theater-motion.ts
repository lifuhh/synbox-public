// Theater Mode on the wide watch page, both ways, frame by frame (desktop Chromium, 1440×900). The audit presses
// Theater Mode, records every rendered frame until the page is still, then presses Default View and records again.
// Each frame it reads where every part of the page is drawn and how opaque, and judges the frames against the
// motion rules:
//
// - teleport: nothing jumps between frames. A shown part's edge never moves more than STEP_PX in one frame, and its
//   opacity never changes by more than POP_STEP (one not drawn counts as 0), so nothing appears from nowhere or
//   vanishes while still visible.
// - scale: a part's width and height each move one way only through a transition (beyond NOISE_PX).
// - detached: the video stays on the stage and the control bar inside it, every frame (within NOISE_PX).
// - iframe: the YouTube iframe is the same element after both toggles, never moved in the document (which reloads
//   it) nor pointed elsewhere.
//
// Each rule counts the parts (per direction) that broke it at least once, so a count reads "how many things moved
// wrong", not how many frames. Dropped frames (a frame gap over 1.5 refreshes while anything moves) are reported, not
// judged: a headless browser's frame clock is uneven. A jump or pop across a stalled frame (over probes/motion.ts ›
// `stallLimit`: 50ms, or three median frames) is the machine's, not counted: the toggle is recorded again, up to
// REDOS times, and each way judged on its first recording where no stall hid a jump; if none, the audit has no sample
// (`machine stalled`). Seen on a loaded machine: entering, no frame for 4 s after the press, then the end layout.
//
// Where it reads the boxes: a part animated by its own transform or opacity is read from its element
// (getBoundingClientRect includes transforms; opacity through every ancestor). A part in a view transition is drawn
// by the browser's snapshot pseudo-elements while its element already sits at its end: the recorder wraps
// document.startViewTransition, notes each part's view-transition-name as the old state is captured and as the new
// state is drawn, and reads ::view-transition-group(name) (box) and ::view-transition-old/new(name) (opacity). A part
// left in the root snapshot cross-fades from where it was to where it ends: it reads as drawn at its end, fading in,
// which the teleport rule counts.
//
// Thresholds: a 0.4 s ease across the ~500px the video grows moves an edge at most ~35px a frame at its fastest, so
// STEP_PX 48 passes any eased move and catches a snap (the snap today moves edges 150-500px in one frame). POP_STEP
// 0.5 is a fade of fewer than two frames. This audit can fold into the shared motion audit (probes/motion.ts) once it
// lands; its rules are the same.

import { writeFileSync } from 'node:fs'
import path from 'node:path'

import type { Page } from 'playwright'

import { open } from '../engines/browser'
import type { BenchContext, Sample } from '../types'
import { LAYOUT_PAGES, PLAYER_SONG } from './layout'
import { REDOS, stallLimit, stallText } from './motion'
import type { Stall } from './motion'

const LIMIT_MS = 120_000
const STEP_PX = 48
const JUMP_SHARE = 0.35
const POP_STEP = 0.5
const NOISE_PX = 1
const SHOWN = 0.02
/** A part's two snapshots (each at least 0.1 opaque, in the recorder) starting further apart: two places at once */
const HANDOVER_PX = 1
/** Frames in a row with nothing moving: the transition is over */
const QUIET_FRAMES = 24
const MAX_RECORD_MS = 4000
const VSYNC_MS = 1000 / 60
const NOTES_PER_RULE = 4

/** The parts of the watch page that Theater Mode moves, opens or closes */
const PARTS: Record<string, string> = {
  bar: '[data-player-stage] [data-player-chrome]',
  next: '.watch-next',
  shelves: '.watch-main > :last-child',
  'side-lyrics': '.watch-side > section',
  song: '.watch-main > :first-child',
  // The song's own rows under the video: its title, the channel's line and the action row (YouTube's link, the
  // lyrics toggles, like, share, report)
  'song-actions': '.watch-main nav[aria-label="Player Controls"]',
  'song-meta': '.watch-main > :first-child h1 + div > :first-child',
  'song-title': '.watch-main > :first-child h1',
  stage: '.watch-stage',
  'under-lyrics': '.watch-main > section',
  video: '[data-stage-video]',
}
/** Parts that must stay on another part: the video on the stage (same box), the bar inside the stage */
const ATTACHED: { part: string; on: string; same: boolean }[] = [
  { on: 'stage', part: 'video', same: true },
  { on: 'stage', part: 'bar', same: false },
]

export const THEATER_MOTION_FINDINGS = [
  'teleports',
  'scaleReversals',
  'detachments',
  'iframeReloads',
] as const

interface Box {
  l: number
  t: number
  r: number
  b: number
  o: number
  /** Drawn by both snapshots of a view transition at once, this far apart (0: one place) */
  split?: number
}
interface Frame {
  t: number
  scroll: number
  parts: Record<string, Box | null>
  /** The browser held the old page's frame (a view transition before its pseudo-elements draw) */
  held?: boolean
}
interface Recorded {
  frames: Frame[]
  /** When the press was released, on the frames' clock */
  input: number | null
}

/** Where a part is drawn inside a view transition: the named box whose snapshot holds it */
interface Snapped {
  name: string
  /** The part's box as shares of that named box (itself: 0, 0, 1, 1) */
  at: [number, number, number, number]
  /** Its opacity inside the snapshot */
  o: number
}
interface Transition {
  old: Record<string, Snapped>
  /** The pseudo-elements are drawn: until then the browser holds the old page's last frame */
  ready: boolean
  done: boolean
}
interface PageRecorder {
  transitions: Transition[]
  frames: Frame[]
  recording: boolean
  actedAt: number | null
  input: number | null
  loads: number
  /** Why the last recording stopped early */
  error: string | null
  /** Records one frame per animation frame until `quiet` still frames after the input, or `maxMs` */
  start: (quiet: number, maxMs: number) => void
}

declare global {
  interface Window {
    __theater?: PageRecorder
  }
}

/* oxlint-disable unicorn/consistent-function-scoping -- the recorder runs in the page: nothing outside it is there */
/** Installed before any page script: wraps startViewTransition so the old state's names are known, and reads frames */
const installRecorder = (parts: Record<string, string>) => {
  const recorder: PageRecorder = {
    actedAt: null,
    error: null,
    frames: [],
    input: null,
    loads: 0,
    recording: false,
    start: () => {
      // Replaced below
    },
    transitions: [],
  }
  window.__theater = recorder
  // The snapshot that draws `el`: its own, or its nearest named ancestor's
  const snappedIn = (el: Element): Snapped | null => {
    let o = 1
    for (let n: Element | null = el; n !== null; n = n.parentElement) {
      const cs = getComputedStyle(n)
      o *=
        cs.visibility === 'hidden' || cs.display === 'none'
          ? 0
          : Number(cs.opacity)
      const name = cs.viewTransitionName
      if (name !== 'none' && name !== '') {
        const a = n.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        return {
          at: [
            (r.left - a.left) / a.width,
            (r.top - a.top) / a.height,
            r.width / a.width,
            r.height / a.height,
          ],
          name,
          o,
        }
      }
    }
    return null
  }
  if (typeof document.startViewTransition === 'function') {
    const original = document.startViewTransition.bind(document)
    document.startViewTransition = (
      update?: Parameters<Document['startViewTransition']>[0]
    ) => {
      const old: Record<string, Snapped> = {}
      for (const [part, selector] of Object.entries(parts)) {
        const el = document.querySelector(selector)
        const snapped = el === null ? null : snappedIn(el)
        if (snapped !== null) {
          old[part] = snapped
        }
      }
      const entry: Transition = { done: false, old, ready: false }
      recorder.transitions.push(entry)
      const transition = original(update)
      const follow = async () => {
        try {
          await transition.ready
          entry.ready = true
          await transition.finished
        } finally {
          entry.done = true
        }
      }
      void follow()
      return transition
    }
  }

  // The page's <html> is read when needed: an init script runs before it exists
  const opacityOf = (el: Element) => {
    let o = 1
    for (let n: Element | null = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.visibility === 'hidden' || cs.display === 'none') {
        return 0
      }
      o *= Number(cs.opacity)
    }
    return o
  }
  const pseudo = (kind: string, name: string) =>
    getComputedStyle(
      document.documentElement,
      `::view-transition-${kind}(${name})`
    )
  // The group's drawn box: its own box at the snapshot's top left, through its transform about its origin
  const groupBox = (name: string) => {
    const g = pseudo('group', name)
    // "123.4px"; "auto" while no such group is drawn
    const width = Number(g.width.replace('px', ''))
    const height = Number(g.height.replace('px', ''))
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return null
    }
    const [ox = 0, oy = 0] = g.transformOrigin
      .split(' ')
      .map((v) => Number(v.replace('px', '')))
    const m = new DOMMatrix(g.transform === 'none' ? undefined : g.transform)
    const corners = [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ].map(([x = 0, y = 0]) => {
      const p = m.transformPoint(new DOMPoint(x - ox, y - oy))
      return { x: p.x + ox, y: p.y + oy }
    })
    return {
      b: Math.max(...corners.map((c) => c.y)),
      l: Math.min(...corners.map((c) => c.x)),
      o: Number(g.opacity),
      r: Math.max(...corners.map((c) => c.x)),
      t: Math.min(...corners.map((c) => c.y)),
    }
  }
  // A part drawn by a snapshot: the group's box, the part's share of it, the snapshots' opacity
  const snapshotBox = (
    snapped: Snapped,
    before: Snapped | null,
    now: Snapped | null
  ): Box | null => {
    const { name } = snapped
    const g = groupBox(name)
    if (g === null) {
      return null
    }
    const groupW = Number(pseudo('group', name).width.replace('px', ''))
    const groupH = Number(pseudo('group', name).height.replace('px', ''))
    // Where one snapshot draws the part: its share of the snapshot, the snapshot's share of the group (a snapshot
    // at its own size, from the group's top left, is not stretched to it), through the group's drawn box
    const drawnBy = (kind: 'old' | 'new', at: Snapped['at']) => {
      const image = pseudo(kind, name)
      const sx = Number(image.width.replace('px', '')) / groupW
      const sy = Number(image.height.replace('px', '')) / groupH
      const [fx, fy, fw, fh] = at
      const w0 = (g.r - g.l) * (Number.isFinite(sx) ? sx : 1)
      const h0 = (g.b - g.t) * (Number.isFinite(sy) ? sy : 1)
      return {
        b: g.t + (fy + fh) * h0,
        l: g.l + fx * w0,
        r: g.l + (fx + fw) * w0,
        t: g.t + fy * h0,
      }
    }
    const oldO =
      before?.name === name ? Number(pseudo('old', name).opacity) * before.o : 0
    const newO =
      now?.name === name ? Number(pseudo('new', name).opacity) * now.o : 0
    const oldBox = before?.name === name ? drawnBy('old', before.at) : null
    const newBox = now?.name === name ? drawnBy('new', now.at) : null
    const shown = newO >= oldO ? (newBox ?? oldBox) : (oldBox ?? newBox)
    if (shown === null) {
      return null
    }
    // Both snapshots drawing it at once, starting in different places: a cross-fade between two places, not a move.
    // Where it starts, not its size: a box that only grows wider cross-fades in place
    const split =
      oldBox !== null && newBox !== null && Math.min(oldO, newO) > 0.1
        ? Math.max(Math.abs(oldBox.l - newBox.l), Math.abs(oldBox.t - newBox.t))
        : 0
    return { ...shown, o: g.o * Math.max(oldO, newO), split }
  }
  // A part drawn by its element. In a transition, one with no named box of its own is drawn in the root's snapshots:
  // at its end, fading in
  const elementBox = (el: Element, inTransition: boolean): Box | null => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) {
      return null
    }
    const rootIn = inTransition
      ? Number(pseudo('new', 'root').opacity || '1')
      : 1
    return {
      b: r.bottom,
      l: r.left,
      o: opacityOf(el) * rootIn,
      r: r.right,
      t: r.top,
    }
  }
  // One frame's boxes
  const read = (): Frame => {
    const active = recorder.transitions.find((t) => !t.done) ?? null
    const t = performance.now()
    // Between the call and `ready` the browser shows the old page's last frame, whatever the DOM now holds
    if (active !== null && !active.ready) {
      return { held: true, parts: {}, scroll: 0, t }
    }
    const out: Record<string, Box | null> = {}
    for (const [part, selector] of Object.entries(parts)) {
      const el = document.querySelector(selector)
      const now = active === null || el === null ? null : snappedIn(el)
      const before = active?.old[part] ?? null
      const snapped = now ?? before
      if (snapped === null) {
        out[part] = el === null ? null : elementBox(el, active !== null)
      } else {
        out[part] = snapshotBox(snapped, before, now)
      }
    }
    return { parts: out, scroll: document.scrollingElement?.scrollTop ?? 0, t }
  }

  recorder.start = (quiet, maxMs) => {
    recorder.frames = []
    recorder.recording = true
    recorder.actedAt = null
    recorder.input = null
    recorder.error = null
    // When the press lands: the release, which a button acts on
    addEventListener(
      'pointerup',
      () => {
        recorder.input = performance.now()
      },
      { capture: true, once: true }
    )
    let still = 0
    let last = ''
    let drawn: Frame = { parts: {}, scroll: 0, t: 0 }
    const tick = () => {
      let frame: Frame
      try {
        frame = read()
      } catch (error) {
        // A frame that can't be read ends the recording with what it saw, and says why
        recorder.error = String(error)
        recorder.recording = false
        return
      }
      if (frame.held === true) {
        // The old page's last frame, still on screen
        frame.parts = drawn.parts
        frame.scroll = drawn.scroll
      } else {
        drawn = frame
      }
      recorder.frames.push(frame)
      const key = JSON.stringify(frame.parts)
      // A held frame is a wait, not rest: the transition hasn't started
      still = key === last && frame.held !== true ? still + 1 : 0
      last = key
      // Stillness counts only once the input is in: the page rests before it too
      const acted = recorder.actedAt
      if (
        acted !== null &&
        (still >= quiet || performance.now() - acted > maxMs)
      ) {
        recorder.recording = false
      } else {
        requestAnimationFrame(tick)
      }
    }
    requestAnimationFrame(tick)
  }
}
/* oxlint-enable unicorn/consistent-function-scoping */

/** Records frames from now until QUIET_FRAMES frames in a row change nothing after `act`, or MAX_RECORD_MS */
const record = async (
  page: Page,
  act: () => Promise<void>
): Promise<Recorded> => {
  await page.evaluate(
    ({ quiet, maxMs }) => {
      window.__theater?.start(quiet, maxMs)
    },
    { maxMs: MAX_RECORD_MS, quiet: QUIET_FRAMES }
  )
  // A few frames of rest first, so the first move is judged against where the part rested
  await page.waitForTimeout(100)
  await act()
  await page.evaluate(() => {
    if (window.__theater !== undefined) {
      window.__theater.actedAt = performance.now()
    }
  })
  await page.waitForFunction(
    () => window.__theater?.recording === false,
    null,
    {
      timeout: MAX_RECORD_MS + 2000,
    }
  )
  const recorded = await page.evaluate(() => ({
    error: window.__theater?.error ?? null,
    frames: window.__theater?.frames ?? [],
    input: window.__theater?.input ?? null,
  }))
  if (recorded.error !== null) {
    throw new Error(`a frame couldn't be read: ${recorded.error}`)
  }
  return recorded
}

const shown = (b: Box | null | undefined): b is Box =>
  b !== null && b !== undefined && b.o > SHOWN

interface Judged {
  teleports: Set<string>
  scaleReversals: Set<string>
  detachments: Set<string>
  notes: string[]
  dropped: number
  /** From the release to the first frame that shows any change, and to the last */
  startMs: number
  doneMs: number
  /** Jumps across stalled frames, not counted: the direction is recorded again. Null when none hid one */
  stall: Stall | null
  /** Frames over the stall limit after the one before, whatever they hid */
  stalledFrames: number
}

const EDGES = ['l', 'r', 't', 'b'] as const
type Size = Record<'w' | 'h', number>

/** One direction's findings, gathered frame by frame */
class Judgement {
  readonly out: Judged = {
    detachments: new Set(),
    doneMs: 0,
    dropped: 0,
    notes: [],
    scaleReversals: new Set(),
    stall: null,
    stalledFrames: 0,
    startMs: 0,
    teleports: new Set(),
  }
  readonly limitMs: number
  private readonly noted: Record<string, number> = {}
  // Each part's last size and the way each axis last moved
  private readonly sizes: Record<string, Size> = {}
  private readonly ways: Record<string, Size> = {}
  private readonly direction: string
  // How far each edge of each part goes over the whole transition: a frame's step is judged against it
  private readonly travel: Record<string, number[]>

  constructor(
    direction: string,
    travel: Record<string, number[]>,
    limitMs: number
  ) {
    this.direction = direction
    this.travel = travel
    this.limitMs = limitMs
  }

  note(rule: string, text: string) {
    this.noted[rule] = (this.noted[rule] ?? 0) + 1
    if (this.noted[rule] <= NOTES_PER_RULE) {
      this.out.notes.push(`${this.direction}: ${rule}: ${text}`)
    }
  }

  /** A jump between two frames: a teleport, or, across a stalled frame, the machine's (kept aside, not counted) */
  private jump(part: string, i: number, gapMs: number, text: string) {
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
    this.out.teleports.add(part)
    this.note('teleport', text)
  }

  /** Whether the part changed between the frames */
  step(
    part: string,
    i: number,
    prev: Frame,
    cur: Frame,
    gapMs: number
  ): boolean {
    const a = prev.parts[part]
    const b = cur.parts[part]
    const ao = shown(a) ? a.o : 0
    const bo = shown(b) ? b.o : 0
    if (Math.abs(bo - ao) > POP_STEP) {
      this.jump(
        part,
        i,
        gapMs,
        `${part} opacity ${ao.toFixed(2)} → ${bo.toFixed(2)} in one frame (frame ${i})`
      )
    }
    if (!shown(a) || !shown(b)) {
      return ao !== bo
    }
    const scrolled = cur.scroll - prev.scroll
    const steps = [
      b.l - a.l,
      b.r - a.r,
      b.t - a.t + scrolled,
      b.b - a.b + scrolled,
    ].map(Math.abs)
    // A late frame carries up to two frames' worth of a move
    const late = Math.min(2, Math.max(1, (cur.t - prev.t) / VSYNC_MS))
    const travel = this.travel[part] ?? [0, 0, 0, 0]
    const jumped = steps.some(
      (s, edge) =>
        s > STEP_PX * late && s > JUMP_SHARE * late * (travel[edge] ?? 0)
    )
    if (jumped && Math.min(ao, bo) > POP_STEP) {
      this.jump(
        part,
        i,
        gapMs,
        `${part} jumped ${Math.round(Math.max(...steps))}px in one frame (frame ${i}: ${Math.round(a.l)},${Math.round(a.t)} ${Math.round(a.r - a.l)}×${Math.round(a.b - a.t)} → ${Math.round(b.l)},${Math.round(b.t)} ${Math.round(b.r - b.l)}×${Math.round(b.b - b.t)})`
      )
    }
    // Two copies at once in different places: the old snapshot fading out where it was and the new fading in where it
    // ends. Not a move, a jump through a cross-fade
    if ((b.split ?? 0) > HANDOVER_PX) {
      this.out.teleports.add(part)
      this.note(
        'teleport',
        `${part} drawn in two places ${Math.round(b.split ?? 0)}px apart (frame ${i}: the old snapshot fading out, the new fading in)`
      )
    }
    this.size(part, i, { h: b.b - b.t, w: b.r - b.l })
    return ao !== bo || Math.max(...steps) > NOISE_PX / 2
  }

  /** A size moves one way only */
  private size(part: string, i: number, size: Size) {
    const before = this.sizes[part]
    if (before === undefined) {
      this.sizes[part] = size
      return
    }
    for (const axis of ['w', 'h'] as const) {
      const d = size[axis] - before[axis]
      if (Math.abs(d) <= NOISE_PX) {
        continue
      }
      const way = Math.sign(d)
      const ways = this.ways[part] ?? { h: 0, w: 0 }
      if (ways[axis] !== 0 && way !== ways[axis]) {
        this.out.scaleReversals.add(part)
        this.note(
          'scale',
          `${part} ${axis === 'w' ? 'width' : 'height'} turned back at frame ${i} (${Math.round(before[axis])} → ${Math.round(size[axis])})`
        )
      }
      ways[axis] = way
      this.ways[part] = ways
      before[axis] = size[axis]
    }
  }

  /** The video on the stage, the bar inside it */
  attached(i: number, cur: Frame) {
    for (const { part, on, same } of ATTACHED) {
      const p = cur.parts[part]
      const c = cur.parts[on]
      if (!shown(p) || !shown(c)) {
        continue
      }
      const off = same
        ? Math.max(...EDGES.map((edge) => Math.abs(p[edge] - c[edge])))
        : Math.max(c.l - p.l, p.r - c.r, c.t - p.t, p.b - c.b, 0)
      if (off > NOISE_PX) {
        this.out.detachments.add(part)
        this.note(
          'detachments',
          `${part} ${Math.round(off)}px off the ${on} at frame ${i}`
        )
      }
    }
  }

  done(): Judged {
    for (const [rule, n] of Object.entries(this.noted)) {
      if (n > NOTES_PER_RULE) {
        this.out.notes.push(
          `${this.direction}: ${rule}: ${n - NOTES_PER_RULE} more not listed`
        )
      }
    }
    return this.out
  }
}

const travelOf = (frames: Frame[]): Record<string, number[]> => {
  const travel: Record<string, number[]> = {}
  for (const part of Object.keys(PARTS)) {
    const seen = frames.map((f) => f.parts[part]).filter(shown)
    const [first] = seen
    if (first !== undefined) {
      travel[part] = EDGES.map((edge) =>
        Math.max(...seen.map((box) => Math.abs(box[edge] - first[edge])))
      )
    }
  }
  return travel
}

export const judge = (
  direction: string,
  { frames, input }: Recorded
): Judged => {
  const judgement = new Judgement(
    direction,
    travelOf(frames),
    stallLimit(frames.map((f) => f.t))
  )
  const { out } = judgement
  let firstMove: number | null = null
  let lastMove: number | null = null
  let moving = false
  for (let i = 1; i < frames.length; i += 1) {
    const prev = frames[i - 1]
    const cur = frames[i]
    // This frame's gap, or the one before's: what moved during a stall can show in the frame after the late one
    const gapMs = Math.max(
      cur.t - prev.t,
      prev.t - (frames[i - 2]?.t ?? prev.t)
    )
    const changed = Object.keys(PARTS).map((part) =>
      judgement.step(part, i, prev, cur, gapMs)
    )
    const anyMove = changed.includes(true)
    judgement.attached(i, cur)
    if ((anyMove || moving) && cur.t - prev.t > VSYNC_MS * 1.5) {
      out.dropped += 1
    }
    out.stalledFrames += cur.t - prev.t > judgement.limitMs ? 1 : 0
    if (anyMove && input !== null && cur.t >= input) {
      firstMove ??= cur.t
      lastMove = cur.t
    }
    moving = anyMove
  }
  if (input !== null && firstMove !== null && lastMove !== null) {
    out.startMs = Math.round(firstMove - input)
    out.doneMs = Math.round(lastMove - input)
  }
  return judgement.done()
}

// The controls show while the pointer is over the stage: brought up, and the pointer rested on the button, before
// the recording starts; the press itself is the recorded input
const pointAt = async (page: Page, name: string) => {
  await page
    .locator('[data-player-stage]')
    .hover({ position: { x: 60, y: 60 } })
  const button = page.getByRole('button', { exact: true, name })
  await button.hover()
  return button
}

/** One run against any served copy (a dev server while working: `theaterRun('http://localhost:5173/v/…', dir)`) */
export const theaterRun = async (
  url: string,
  artifactDir: string
): Promise<Sample> => {
  const player = LAYOUT_PAGES.find((p) => p.name === 'player')
  if (player === undefined) {
    throw new Error('no player page in LAYOUT_PAGES')
  }
  const { page, close } = await open({ engine: 'chromium', kind: 'desktop' })
  try {
    await page.addInitScript(installRecorder, PARTS)
    await page.goto(url, { waitUntil: 'commit' })
    await player.ready(page)
    // The iframe the page built, marked, and every time the page takes it out of the document (a move reloads it
    // too) or points it elsewhere counted. Its own load events are not: the embed navigates inside itself as it
    // plays, toggle or not
    await page.evaluate(() => {
      const frame = document.querySelector('[data-stage-video] iframe')
      if (!(frame instanceof HTMLIFrameElement)) {
        throw new Error('no YouTube iframe')
      }
      frame.dataset.theaterProbe = ''
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page: nothing outside this function is there
      const count = () => {
        if (window.__theater !== undefined) {
          window.__theater.loads += 1
        }
      }
      new MutationObserver((records) => {
        for (const r of records) {
          const removed = [...r.removedNodes].some(
            (node) => node === frame || node.contains(frame)
          )
          if (removed || (r.type === 'attributes' && r.target === frame)) {
            count()
          }
        }
      }).observe(document.body, {
        attributeFilter: ['src'],
        attributes: true,
        childList: true,
        subtree: true,
      })
    })
    const press = async () => {
      await page.mouse.down()
      await page.mouse.up()
    }
    // In and out, again while a stall hid a jump in either way (probes/motion.ts › "stall"); each way is judged on
    // its first recording where none did
    const attempts: { enter: Recorded; exit: Recorded }[] = []
    const kept: Partial<Record<'enter' | 'exit', Judged>> = {}
    const stalls: string[] = []
    let stalledFrames = 0
    for (
      let attempt = 0;
      attempt <= REDOS && (kept.enter === undefined || kept.exit === undefined);
      attempt += 1
    ) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one toggle after the other
      await page.waitForTimeout(attempt === 0 ? 500 : 600)
      // oxlint-disable-next-line eslint/no-await-in-loop -- one toggle after the other
      await pointAt(page, 'Theater Mode')
      // oxlint-disable-next-line eslint/no-await-in-loop -- one toggle after the other
      const enter = await record(page, press)
      // oxlint-disable-next-line eslint/no-await-in-loop -- one toggle after the other
      await page.waitForSelector('[data-theater]', { timeout: 5000 })
      // oxlint-disable-next-line eslint/no-await-in-loop -- one toggle after the other
      await page.waitForTimeout(600)
      // oxlint-disable-next-line eslint/no-await-in-loop -- one toggle after the other
      await pointAt(page, 'Default View')
      // oxlint-disable-next-line eslint/no-await-in-loop -- one toggle after the other
      const exit = await record(page, press)
      // oxlint-disable-next-line eslint/no-await-in-loop -- one toggle after the other
      await page.waitForSelector('.watch-page:not([data-theater])', {
        timeout: 5000,
      })
      attempts.push({ enter, exit })
      for (const [way, rec] of [
        ['enter', enter],
        ['exit', exit],
      ] as const) {
        const j = judge(way, rec)
        stalledFrames += j.stalledFrames
        if (j.stall === null) {
          kept[way] ??= j
        } else {
          stalls.push(
            `${way}, attempt ${attempt + 1}: run again: ${stallText(j.stall)}`
          )
        }
      }
    }
    const iframe = await page.evaluate(() => ({
      loads: window.__theater?.loads ?? 0,
      same:
        document.querySelector(
          '[data-stage-video] iframe[data-theater-probe]'
        ) !== null,
    }))
    writeFileSync(
      path.join(artifactDir, 'frames.json'),
      JSON.stringify(
        attempts.length === 1 ? attempts[0] : { attempts },
        null,
        1
      )
    )
    if (kept.enter === undefined || kept.exit === undefined) {
      throw new Error(
        `machine stalled: ${kept.enter === undefined ? 'enter' : 'exit'} stalled on all ${REDOS + 1} attempts (last: ${stalls.at(-1) ?? 'unknown'})`
      )
    }
    const judged = [kept.enter, kept.exit]
    const sum = (key: 'teleports' | 'scaleReversals' | 'detachments') =>
      judged.reduce((n, j) => n + j[key].size, 0)
    const iframeReloads = iframe.loads + (iframe.same ? 0 : 1)
    return {
      notes: [
        ...stalls,
        ...judged.flatMap((j) => j.notes),
        ...(iframeReloads > 0
          ? [
              `the YouTube iframe ${iframe.same ? `was moved or pointed elsewhere ${iframe.loads} time(s)` : 'was replaced'}`,
            ]
          : []),
      ],
      values: {
        detachments: sum('detachments'),
        droppedFrames: judged.reduce((n, j) => n + j.dropped, 0),
        enterDoneMs: judged[0].doneMs,
        enterStartMs: judged[0].startMs,
        exitDoneMs: judged[1].doneMs,
        exitStartMs: judged[1].startMs,
        frames: attempts.reduce(
          (n, a) => n + a.enter.frames.length + a.exit.frames.length,
          0
        ),
        iframeReloads,
        redos: attempts.length - 1,
        scaleReversals: sum('scaleReversals'),
        stalledFrames,
        teleports: sum('teleports'),
      },
    }
  } finally {
    await close()
  }
}

/** Theater Mode's transition on the wide watch page, both ways */
export const theaterMotionAudit = async (
  ctx: BenchContext
): Promise<{ samples: Sample[]; errors: string[] }> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  // oxlint-disable-next-line promise/avoid-new -- settles when the limit passes
  const stuck = new Promise<{ samples: Sample[]; errors: string[] }>(
    (resolve) => {
      timer = setTimeout(() => {
        resolve({
          errors: [`theater motion audit stuck for ${LIMIT_MS / 1000}s`],
          samples: [],
        })
      }, LIMIT_MS)
    }
  )
  try {
    return await Promise.race([
      theaterRun(`${ctx.origin}/v/${PLAYER_SONG}`, ctx.artifactDir).then(
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
