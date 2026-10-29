import { describe, expect, test } from 'vite-plus/test'

import { boostWithin } from './use-rows-boost'

// A line's rows as widths in ems of their own type; 0 for a row without text, a list for a translation in parts
const parts = (ems: number | number[]) =>
  (Array.isArray(ems) ? ems : [ems]).filter((part) => part > 0)
const line = (
  japanese: number,
  romaji: number,
  translation: number | number[]
) => ({
  japanese: parts(japanese),
  romaji: parts(romaji),
  translation: parts(translation),
})

describe('boostWithin', () => {
  test('a lone row takes the whole boost while its lines stay one row', () => {
    // 10em of Japanese at 25px is 250px, far inside 600px even at 1.2x
    const lines = Array.from({ length: 10 }, () => line(10, 20, 20))
    expect(boostWithin(lines, ['japanese'], 1.2, 25, 600)).toBeCloseTo(1.2)
  })

  test('a lone row stops growing where its lines would wrap taller than the three rows', () => {
    // 23em at 25px is 575px of 600px: one row plain. Wrapped to two at 1.2x it would stand 120px, past the line's
    // three rows plain (50 + 27.2 + 23.8px), so it grows only while it still fits one row: 600 / 575
    const lines = Array.from({ length: 10 }, () => line(23, 30, 30))
    expect(boostWithin(lines, ['japanese'], 1.2, 25, 600)).toBeCloseTo(1.04, 2)
  })

  test('rows that already fill the width keep their plain size', () => {
    // 30em of romaji at 20px and 34.2em of translation at 17.5px each just fit 600px: any growth wraps both
    const lines = Array.from({ length: 10 }, () => line(4, 30, 34.2))
    expect(boostWithin(lines, ['romaji', 'translation'], 1.15, 25, 600)).toBe(1)
  })

  test('one line that would outgrow its budget does not hold the boost back for the rest', () => {
    // Nine lines with long romaji (two rows either way) and one with only a row-wide romaji, which a boost wraps
    const lines = [
      ...Array.from({ length: 9 }, () => line(4, 37.5, 10)),
      line(0, 30, 0),
    ]
    expect(boostWithin(lines, ['romaji'], 1.25, 25, 600)).toBeCloseTo(1.25)
  })

  test('a translation split in two rows stands two rows, though it would fit one', () => {
    // Two 12em parts at 17.5px are 210px each: one 24em line (420px) would fit 600px, but split it draws as two
    // rows. Budget 50 + 27.2 + 47.6px; shown, 50b + 47.6b, so the boost stops at 1.27 (one row would allow 1.36)
    const lines = Array.from({ length: 10 }, () => line(4, 20, [12, 12]))
    expect(
      boostWithin(lines, ['japanese', 'translation'], 1.5, 25, 600)
    ).toBeCloseTo(1.27, 2)
  })
})
