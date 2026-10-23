import { describe, expect, test } from 'vite-plus/test'

import { linePhase } from './lyric-line-block'
import { lineReached } from './use-silent-playback'

const LINES = [
  { end: 14, start: 10 },
  { end: 20, start: 15 },
]

describe('lines under a playing song', () => {
  // The intro once lit the first line as sung, then emptied it when its wipe began
  test('no line reads as sung before the first one is reached', () => {
    const reached = lineReached(LINES, 3)
    expect(LINES.map((_, index) => linePhase(index, reached, true))).toEqual([
      'upcoming',
      'upcoming',
    ])
  })

  test('through a gap the last line reached stays lit', () => {
    expect(lineReached(LINES, 14.8)).toBe(1)
    expect(lineReached(LINES, 14.2)).toBe(0)
  })
})
