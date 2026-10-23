import { describe, expect, test } from 'vite-plus/test'

import { lyricsScaleOn } from './lyrics-style'

describe('lyricsScaleOn', () => {
  test('an upright phone keeps one size whatever was saved', () => {
    expect(lyricsScaleOn('portrait', false, 1.6, 1.5)).toBe(1)
    expect(lyricsScaleOn('portrait', false, 0.4, 1)).toBe(1)
  })

  test('a phone on its side holds a desktop-sized pick to its narrow range', () => {
    expect(lyricsScaleOn('landscape', false, 1.6, 1)).toBe(1.25)
    expect(lyricsScaleOn('landscape', true, 0.6, 1)).toBe(0.75)
    expect(lyricsScaleOn('landscape', false, 1.1, 1)).toBeCloseTo(1.1)
  })

  test('a desktop keeps the size times its own tweak', () => {
    expect(lyricsScaleOn('desktop', false, 1.6, 0.85)).toBeCloseTo(1.36)
  })
})
