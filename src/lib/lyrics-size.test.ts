import { describe, expect, test } from 'vite-plus/test'

import { lyricsScaleOn } from './lyrics-style'

describe('lyricsScaleOn', () => {
  test("an upright phone's full-screen player moves only a little from its base", () => {
    expect(lyricsScaleOn('portrait', false, 1.6, 1.5)).toBe(1.2)
    expect(lyricsScaleOn('portrait', false, 0.4, 1)).toBe(0.85)
    expect(lyricsScaleOn('portrait', false, 1.1, 1)).toBeCloseTo(1.1)
  })

  test('a phone on its side holds a desktop-sized pick to its own range', () => {
    expect(lyricsScaleOn('landscape', false, 1.6, 1)).toBe(1.4)
    expect(lyricsScaleOn('landscape', false, 0.4, 1)).toBe(0.6)
    expect(lyricsScaleOn('landscape', true, 1.1, 1)).toBe(1.05)
  })

  test('a desktop keeps the size times its own tweak', () => {
    expect(lyricsScaleOn('desktop', false, 1.6, 0.85)).toBeCloseTo(1.36)
  })
})
