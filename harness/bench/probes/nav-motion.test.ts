import { describe, expect, test } from 'vite-plus/test'

import {
  SLIDE_EASE,
  SLIDE_MS,
  UNDER_SHARE,
  eased,
  judgeNav,
  maxEasedStep,
} from './nav-motion'
import type { Frame, Named, Recorded, Side } from './nav-motion'

const WIDTH = 390
const BAR: Named['box'] = [8, 738, 374, 64]

const side = (x: number, d = 'block'): Side => ({ d, k: false, o: 1, x, y: 0 })

const resting = (t: number): Frame => ({
  bars: { 'nav-dock': { box: BAR, k: false, new: null, o: 1, old: null } },
  drawn: false,
  held: false,
  nav: null,
  page: null,
  root: null,
  t,
  tl: t,
})

// A push's frame `at` ms into the slide: the new page in from the right over the old one, the dock held still
const pushed = (t: number, at: number): Frame => {
  const p = eased(SLIDE_EASE, at / SLIDE_MS)
  return {
    ...resting(t),
    bars: {
      'nav-dock': {
        box: BAR,
        k: false,
        new: side(0),
        o: 1,
        old: side(0, 'none'),
      },
    },
    drawn: true,
    nav: 'push',
    page: {
      box: [0, 0, WIDTH, 844],
      k: false,
      new: side(WIDTH * (1 - p)),
      o: 1,
      old: side(-UNDER_SHARE * WIDTH * p),
    },
    root: { new: 1, old: 0 },
  }
}

const FRAME_MS = 1000 / 60
const START = 5 * FRAME_MS

/** A push drawn at these times into the slide, between frames of the page at rest */
const push = (
  times: number[],
  change?: (frame: Frame, at: number) => Frame
) => {
  const before = [0, 1, 2, 3, 4].map((i) => resting(i * FRAME_MS))
  const slide = times.map((at) =>
    (change ?? ((f) => f))(pushed(START + at, at), at)
  )
  const end = START + (times.at(-1) ?? 0)
  const after = [1, 2, 3].map((i) => resting(end + i * FRAME_MS))
  const recorded: Recorded = {
    back: null,
    frames: [...before, ...slide, ...after],
    transitions: [
      { done: true, had: ['nav-dock'], has: ['nav-dock'], kind: 'push' },
    ],
  }
  return judgeNav('push', recorded)
}

/** Every 60 Hz frame of the slide, the last one the first at or past its end */
const everyFrame = () => {
  const times: number[] = []
  for (let at = 0; at < SLIDE_MS + FRAME_MS; at += FRAME_MS) {
    times.push(at)
  }
  return times
}

const CLEAN = {
  barMoves: 0,
  durationOff: 0,
  fadeExtras: 0,
  offEnds: 0,
  offPath: 0,
  opacityDips: 0,
  teleports: 0,
  wrongKind: 0,
}

describe('maxEasedStep', () => {
  test('the longest step of a straight line is the share of time itself', () => {
    expect(maxEasedStep([0, 0, 1, 1], 0.1)).toBeCloseTo(0.1, 5)
  })

  test("the slide's curve moves fastest early: about 18% of the travel in one 60 Hz frame", () => {
    const step = maxEasedStep(SLIDE_EASE, FRAME_MS / SLIDE_MS)
    expect(step).toBeGreaterThan(0.17)
    expect(step).toBeLessThan(0.19)
    // Never less than the same time takes anywhere on the curve
    expect(step).toBeGreaterThanOrEqual(
      eased(SLIDE_EASE, 0.5) - eased(SLIDE_EASE, 0.5 - FRAME_MS / SLIDE_MS)
    )
  })
})

describe('judgeNav', () => {
  test('a slide on its curve passes, and so does one that dropped a frame', () => {
    const whole = push(everyFrame())
    expect(whole.counts).toEqual(CLEAN)
    expect(whole.stall).toBeNull()
    expect(whole.worst.stepShare).toBeLessThan(1)
    // The fourth frame never drawn: the next covers two frames of the curve, which the budget follows
    const dropped = push(everyFrame().filter((_, i) => i !== 3))
    expect(dropped.counts).toEqual(CLEAN)
    expect(dropped.dropped).toBe(1)
  })

  test('a page that skips to its end mid-way teleports', () => {
    // On the curve for three frames, then drawn at its end for the rest
    const j = push(everyFrame(), (frame, at) =>
      at > 3 * FRAME_MS && frame.page !== null
        ? { ...frame, page: { ...frame.page, new: side(0) } }
        : frame
    )
    expect(j.counts.teleports).toBe(1)
    expect(j.notes.join('\n')).toContain('the page on top jumped')
  })

  test('the same skip across a stalled frame is the machine’s: a stall, not a teleport', () => {
    // From its start to its end across a 120ms gap: further than the curve goes in that time
    const times = everyFrame().filter((at) => at === 0 || at > 120)
    const j = push(times, (frame, at) =>
      at > 0 && frame.page !== null
        ? { ...frame, page: { ...frame.page, new: side(0) } }
        : frame
    )
    expect(j.counts.teleports).toBe(0)
    expect(j.stall?.hidden).toBe(1)
    expect(j.stalledFrames).toBe(1)
  })

  test('a page that passes its landing and comes back is off its path', () => {
    const j = push(everyFrame(), (frame, at) =>
      at > 300 && at < 340 && frame.page !== null
        ? { ...frame, page: { ...frame.page, new: side(-3) } }
        : frame
    )
    expect(j.counts.offPath).toBe(2)
    expect(j.notes.join('\n')).toContain('came back')
  })

  test('a bar that cross-fades with its own copy, or shifts, moved', () => {
    const j = push(everyFrame(), (frame, at) => ({
      ...frame,
      bars: {
        'nav-dock': {
          box: at > 100 ? [8, 740, 374, 64] : BAR,
          k: false,
          new: side(0),
          o: 1,
          old: side(0),
        },
      },
    }))
    expect(j.counts.barMoves).toBe(2)
  })

  test('a slide that ends early, stops short or leaves html[data-nav] behind fails each rule', () => {
    const short = push(everyFrame().filter((at) => at < 250))
    expect(short.counts.durationOff).toBe(1)
    expect(short.counts.offEnds).toBe(2)
    const left = push(everyFrame())
    expect(left.counts.wrongKind).toBe(0)
    const frames = everyFrame()
    const stuck = judgeNav('push', {
      back: null,
      frames: [
        ...frames.map((at) => pushed(at, at)),
        { ...resting(frames.length * FRAME_MS), nav: 'push' },
      ],
      transitions: [{ done: true, had: [], has: [], kind: 'push' }],
    })
    expect(stuck.counts.wrongKind).toBe(1)
  })
})
