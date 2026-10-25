import { describe, expect, test } from 'vite-plus/test'

import { lyricsScaleOn, rowsBoost } from './lyrics-style'

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

const ROWS = [true, false]
const everyShown = ROWS.flatMap((lyrics) =>
  ROWS.flatMap((romaji) =>
    ROWS.map((translation) => ({ lyrics, romaji, translation }))
  )
)

describe('rowsBoost', () => {
  test('hiding a row never shrinks the rows still shown', () => {
    for (const twoLines of [false, true]) {
      for (const shown of everyShown) {
        // Two lines' rows are the Japanese and the romaji; their translation hangs apart
        const rows = twoLines
          ? (['lyrics', 'romaji'] as const)
          : (['lyrics', 'romaji', 'translation'] as const)
        for (const row of rows) {
          if (shown[row] && rows.filter((other) => shown[other]).length > 1) {
            expect(
              rowsBoost({ ...shown, [row]: false }, twoLines)
            ).toBeGreaterThanOrEqual(rowsBoost(shown, twoLines))
          }
        }
      }
    }
  })

  test('a lone romaji or translation never outgrows the Japanese it stands in for', () => {
    const alone = { lyrics: false, romaji: false, translation: false }
    // The romaji is 0.8 of the Japanese's size, the translation 0.7 (--text-lyric-romaji, -secondary)
    expect(
      0.8 * rowsBoost({ ...alone, romaji: true }, false)
    ).toBeLessThanOrEqual(1)
    expect(
      0.7 * rowsBoost({ ...alone, translation: true }, false)
    ).toBeLessThanOrEqual(1)
    expect(
      (12 / 17) * rowsBoost({ ...alone, romaji: true }, true)
    ).toBeLessThanOrEqual(1)
  })
})
