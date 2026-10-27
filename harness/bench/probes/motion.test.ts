import { describe, expect, test } from 'vite-plus/test'

import { judge } from './motion'
import type { Frame, MorphPart, Shown } from './motion'

const PARTS: MorphPart[] = [
  { name: 'box', selector: '.box' },
  {
    name: 'pill',
    selector: '.pill',
    within: { drift: { x: 1, y: 1 }, part: 'box', x: 'end', y: 'centre' },
  },
]

const el = (id: number, l: number, r: number, o = 1): Shown => ({
  a: 100,
  b: 50,
  id,
  l,
  o,
  r,
  t: 10,
})

const at = (e: Shown, dy: number): Shown => ({ ...e, b: e.b + dy, t: e.t + dy })

const frame = (i: number, box: Shown[], pill: Shown[]): Frame => ({
  parts: { box, pill },
  scroll: 0,
  t: i * 16.7,
  work: 4,
})

// The box and its pill 600px further right in one step: after a normal frame a teleport; after a 120ms gap the
// machine's stall, kept aside so the pass runs again
const jumpAfter = (gapMs: number) => {
  const rest = [0, 1, 2, 3, 4, 5].map((i) =>
    frame(i, [el(1, 0, 600)], [el(2, 420, 595)])
  )
  const last = rest.at(-1)?.t ?? 0
  return judge(
    [
      ...rest,
      {
        ...frame(6, [el(1, 600, 1200)], [el(2, 1020, 1195)]),
        t: last + gapMs,
      },
    ],
    PARTS
  )
}

describe('judge', () => {
  test('a pill handed to a copy at the box’s far end is a teleport, and detached', () => {
    // The real box and pill, then a copy of the box in the same place and a copy of the pill at its left end
    const frames = [
      frame(0, [el(1, 0, 600)], [el(2, 420, 595)]),
      frame(1, [el(3, 0, 600)], [el(4, 0, 175)]),
      frame(2, [el(3, 0, 598)], [el(4, 200, 375)]),
    ]
    const j = judge(frames, PARTS)
    expect(j.counts.teleport).toBeGreaterThan(0)
    expect(j.counts.detached).toBeGreaterThan(0)
    expect(j.notes.join('\n')).toContain('pill')
  })

  test('the same hand-over in place, the pill shrinking at the right end, passes', () => {
    const frames = [
      frame(0, [el(1, 0, 600)], [el(2, 420, 595)]),
      frame(1, [el(3, 0, 600)], [el(4, 420, 595)]),
      frame(2, [el(3, 2, 596)], [el(4, 434, 591, 0.7)]),
      frame(3, [el(3, 6, 590)], [el(4, 450, 585, 0.4)]),
    ]
    const j = judge(frames, PARTS)
    expect(j.counts).toEqual({
      detached: 0,
      frame: 0,
      overshoot: 0,
      scale: 0,
      settle: 0,
      slant: 0,
      teleport: 0,
    })
    expect(j.flight).toBe(true)
  })

  test('a pill whose centre trails the box rising is detached, a little at a time too', () => {
    const frames = [
      frame(0, [el(1, 0, 600)], [el(2, 420, 595)]),
      frame(1, [at(el(1, 0, 600), -2)], [at(el(2, 420, 595), -1)]),
      frame(2, [at(el(1, 0, 600), -4)], [at(el(2, 420, 595), -2)]),
    ]
    expect(judge(frames, PARTS).notes.join('\n')).toContain(
      "2.0px down of where it keeps against box's centre line"
    )
  })

  test('a box whose sides finish before its top is slanted, and one that passes its landing overshoots', () => {
    // The field (1) hands over to the ghost (3), which lands on the bar's field (5), drawn hidden until then
    const bar = (o: number): Shown => ({ ...el(5, 400, 600, o), b: 40, t: 0 })
    const ghost = (l: number, r: number, t: number): Shown => ({
      ...el(3, l, r),
      b: t + 40,
      t,
    })
    const frames = [
      frame(0, [el(1, 0, 800), bar(0)], []),
      frame(1, [ghost(0, 800, 10), bar(0)], []),
      frame(2, [ghost(380, 620, 8), bar(0)], []),
      frame(3, [ghost(398, 602, -3), bar(0)], []),
      frame(4, [bar(1)], []),
    ]
    const j = judge(frames, PARTS)
    expect(j.counts.slant).toBeGreaterThan(0)
    expect(j.counts.overshoot).toBeGreaterThan(0)
  })

  test('a pill that grows in a shrinking morph is a scale reversal', () => {
    const frames = [
      frame(0, [el(1, 0, 600)], [el(2, 420, 595)]),
      frame(1, [el(1, 2, 596)], [el(2, 419, 594)]),
      frame(2, [el(1, 6, 590)], [el(2, 410, 588)]),
    ]
    expect(judge(frames, PARTS).counts.scale).toBe(1)
  })

  test('a jump between frames a normal interval apart is a teleport', () => {
    const j = jumpAfter(16.7)
    expect(j.counts.teleport).toBeGreaterThan(0)
    expect(j.stall).toBeNull()
  })

  test('the same jump across a stalled frame is not a teleport but a stall', () => {
    const j = jumpAfter(120)
    expect(j.counts.teleport).toBe(0)
    expect(j.stall?.frame).toBe(6)
    expect(j.stall?.gapMs).toBeCloseTo(120)
    // Three median frames (16.7ms) apart
    expect(j.stall?.limitMs).toBeCloseTo(50.1)
    expect(j.stalledFrames).toBe(1)
  })
})
