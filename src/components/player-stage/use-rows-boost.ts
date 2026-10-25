import type { RefObject } from 'react'
import { useLayoutEffect } from 'react'

import type { ShownLyricRows } from '@/lib/lyrics-style'

export interface RowTexts {
  japanese: string[]
  romaji: string[]
  translation: string[]
}

type Row = keyof RowTexts
const ROWS: readonly Row[] = ['japanese', 'romaji', 'translation']
const SHOWN_KEY: Record<Row, keyof ShownLyricRows> = {
  japanese: 'lyrics',
  romaji: 'romaji',
  translation: 'translation',
}

// One line's rows as LineRows draws them: each row's selector, its size as a share of the Japanese's
// (--text-lyric-romaji, --text-lyric-secondary) and its line height (leading-loose for the Japanese, room for
// furigana when it wraps; Noto Sans' normal for the rest)
const ROW_SELECTOR: Record<Row, string> = {
  japanese: '[data-row="japanese"]',
  romaji: '[data-row="romaji"]',
  translation: '[data-row="translation"]',
}
const ROW_SHARE: Record<Row, number> = {
  japanese: 1,
  romaji: 0.8,
  translation: 0.7,
}
const ROW_LEADING: Record<Row, number> = {
  japanese: 2,
  romaji: 1.36,
  translation: 1.36,
}
const FLOOR_PX = 12
// Most of the song's lines must keep within the budget, not all: one outlier line would hold the boost back for
// every other line
const SHARE_OF_LINES = 0.9
// Canvas widths run a little under the drawn line's (kerning, karaoke spans)
const SAFETY = 0.96
const PROBE_PX = 100
const STEP = 0.01

// oxlint-disable-next-line unicorn/prefer-number-coercion -- the value ends in px, which Number() rejects
const pixels = (value: string) => Number.parseFloat(value) || 0

const textOf = (element: Element) =>
  element.querySelector('p, .lyric-karaoke-line') ?? element

// How tall one line's shown rows stand at a Japanese size of `japanese` px, given each row's width in ems
const lineHeight = (
  ems: Record<Row, number>,
  rows: readonly Row[],
  japanese: number,
  room: number
) => {
  let height = 0
  for (const row of rows) {
    if (ems[row] > 0) {
      const size = Math.max(FLOOR_PX, japanese * ROW_SHARE[row])
      const wraps = Math.max(1, Math.ceil((ems[row] * size) / room))
      height += wraps * size * ROW_LEADING[row]
    }
  }
  return height
}

// The largest boost up to `wanted` at which most of the song's lines, with only the shown rows, stand no taller
// than the same line with all three rows at the plain size: what the size slider already allows
export const boostWithin = (
  lines: Record<Row, number>[],
  shown: readonly Row[],
  wanted: number,
  japanese: number,
  room: number
) => {
  if (wanted <= 1 || lines.length === 0 || room <= 0 || japanese <= 0) {
    return 1
  }
  const budgets = lines.map((ems) => lineHeight(ems, ROWS, japanese, room))
  const fits = (boost: number) =>
    lines.filter(
      (ems, index) =>
        lineHeight(ems, shown, japanese * boost, room) <= budgets[index]
    ).length >=
    lines.length * SHARE_OF_LINES
  // In whole steps, so the boost never drifts by float error
  const steps = Math.round((wanted - 1) / STEP)
  let step = 0
  while (step < steps && fits(1 + (step + 1) * STEP)) {
    step += 1
  }
  return Math.round((1 + step * STEP) * 100) / 100
}

interface BoostOptions {
  texts: RowTexts
  shown: readonly Row[]
  wanted: number
}

// Measures the song's lines and keeps --lyric-line-boost set on `layer` until the returned cleanup
const watch = (layer: HTMLElement, { texts, shown, wanted }: BoostOptions) => {
  const context = document.createElement('canvas').getContext('2d')
  const widths = new Map<string, number[]>()
  // Each line's width in ems of its row's type, in the row's drawn font
  const emsOf = (row: Row, font: string, spacing: number) => {
    const key = `${row}|${font}|${spacing}`
    const known = widths.get(key)
    if (known || !context) {
      return known ?? []
    }
    context.font = font
    const ems = texts[row].map((text) =>
      text.trim() === ''
        ? 0
        : (context.measureText(text).width + spacing * text.length) /
          PROBE_PX /
          SAFETY
    )
    widths.set(key, ems)
    return ems
  }
  // The rows not shown are measured in the font of a shown one: only their share of the height counts
  const fonts = new Map<Row, { font: string; spacing: number }>()
  let resize: ResizeObserver | null = null
  let observed: HTMLElement | null = null
  let boost = 1
  const apply = () => {
    layer.style.setProperty('--lyric-line-boost', String(boost))
  }
  const measure = () => {
    const block = layer.querySelector<HTMLElement>('.player-lyrics-overlay')
    const handle = block?.querySelector<HTMLElement>(
      '[data-testid="lyrics-handle"]'
    )
    if (!(block && handle)) {
      return
    }
    // The block resizes with the type, so a size change (a slider drag) measures again
    if (observed !== block) {
      observed = block
      resize?.observe(block)
    }
    let japanese = 0
    for (const row of shown) {
      const sample = block.querySelector(ROW_SELECTOR[row])
      if (sample) {
        const style = getComputedStyle(textOf(sample))
        const size = pixels(style.fontSize)
        fonts.set(row, {
          font: `${style.fontWeight} ${PROBE_PX}px ${style.fontFamily}`,
          spacing:
            size > 0 ? (pixels(style.letterSpacing) / size) * PROBE_PX : 0,
        })
        // The plain Japanese size, from any shown row's drawn size and the boost it was drawn at
        if (japanese === 0 && size > FLOOR_PX) {
          japanese = size / boost / ROW_SHARE[row]
        }
      }
    }
    const fallback = fonts.values().next().value
    if (japanese === 0 || !fallback) {
      return
    }
    const blockStyle = getComputedStyle(block)
    const handleStyle = getComputedStyle(handle)
    const room =
      block.clientWidth -
      pixels(blockStyle.paddingLeft) -
      pixels(blockStyle.paddingRight) -
      pixels(handleStyle.paddingLeft) -
      pixels(handleStyle.paddingRight)
    const emsFor = (row: Row) => {
      const { font, spacing } = fonts.get(row) ?? fallback
      return emsOf(row, font, spacing)
    }
    const perRow = {
      japanese: emsFor('japanese'),
      romaji: emsFor('romaji'),
      translation: emsFor('translation'),
    }
    const lines = texts.japanese.map((_, index) => ({
      japanese: perRow.japanese[index] ?? 0,
      romaji: perRow.romaji[index] ?? 0,
      translation: perRow.translation[index] ?? 0,
    }))
    const next = boostWithin(lines, shown, wanted, japanese, room)
    if (next !== boost) {
      boost = next
      apply()
    }
  }
  resize = new ResizeObserver(measure)
  resize.observe(layer)
  apply()
  measure()
  // A row appears only with its line, and its font and size are read from it
  const rows = new MutationObserver(measure)
  rows.observe(layer, { childList: true, subtree: true })
  const fontsLoaded = () => {
    widths.clear()
    measure()
  }
  document.fonts.addEventListener('loadingdone', fontsLoaded)
  return () => {
    rows.disconnect()
    resize.disconnect()
    document.fonts.removeEventListener('loadingdone', fontsLoaded)
    layer.style.removeProperty('--lyric-line-boost')
  }
}

// One line's rows grow when others are hidden (lyrics-style.ts › rowsBoost asks how much), as far as the song's
// lines still stand no taller than with all three rows: a lone row can wrap where the bigger type needs it, but the
// block never grows past what the size slider allows. Line widths are measured on a canvas in each row's drawn
// font; the boost is set on the layer as --lyric-line-boost (globals.css --text-lyric*), and recomputed when the
// size, the width, the fonts, the song or the rows shown change. No line is laid out to find it
export const useRowsBoost = (
  layerRef: RefObject<HTMLElement | null>,
  {
    texts,
    shown: { lyrics, romaji, translation },
    wanted,
    enabled,
  }: {
    texts: RowTexts
    shown: ShownLyricRows
    wanted: number
    enabled: boolean
  }
) => {
  // Before paint, so turning a row off never draws a frame at the old boost
  useLayoutEffect(() => {
    const layer = layerRef.current
    const shown = { lyrics, romaji, translation }
    const shownRows = ROWS.filter((row) => shown[SHOWN_KEY[row]])
    return enabled && layer
      ? watch(layer, { shown: shownRows, texts, wanted })
      : undefined
  }, [layerRef, texts, lyrics, romaji, translation, wanted, enabled])
}
