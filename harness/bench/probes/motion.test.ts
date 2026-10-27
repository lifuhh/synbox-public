import { describe, expect, test } from 'vite-plus/test'

import { judge } from './motion'
import type { Frame, MorphPart, Shown } from './motion'

const PARTS: MorphPart[] = [
  { name: 'box', selector: '.box' },
  {
    name: 'pill',
    selector: '.pill',
    within: { drift: 4, part: 'box', x: 'end', y: 'centre' },
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

const frame = (i: number, box: Shown[], pill: Shown[]): Frame => ({
  parts: { box, pill },
  scroll: 0,
  t: i * 16.7,
  work: 4,
})

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
    expect(j.counts).toEqual({ detached: 0, frame: 0, scale: 0, teleport: 0 })
    expect(j.flight).toBe(true)
  })

  test('a pill that grows in a shrinking morph is a scale reversal', () => {
    const frames = [
      frame(0, [el(1, 0, 600)], [el(2, 420, 595)]),
      frame(1, [el(1, 2, 596)], [el(2, 419, 594)]),
      frame(2, [el(1, 6, 590)], [el(2, 410, 588)]),
    ]
    expect(judge(frames, PARTS).counts.scale).toBe(1)
  })
})
