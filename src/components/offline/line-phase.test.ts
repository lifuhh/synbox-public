import { describe, expect, test } from 'vite-plus/test'

import { linePhase } from './lyric-line-block'
import { lineFollowed, lineReached } from './use-silent-playback'

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

  // kwaMeEJCwFs (2026-10-27): the watch page scrolled to the next line 0.65 s before it, in 83 of 92 lines while
  // the one before was still sung, because it followed lineReached
  test('a box follows the line still being sung, not the next one about to start', () => {
    const fast = [
      { end: 11.3, start: 10 },
      { end: 12.6, start: 11.3 },
    ]
    expect(lineReached(fast, 10.9)).toBe(1)
    expect(lineFollowed(fast, 10.9)).toBe(0)
    expect(lineFollowed(fast, 11.3)).toBe(1)
    // Through a gap it still holds the last line reached
    expect(lineFollowed(LINES, 14.8)).toBe(1)
  })
})
