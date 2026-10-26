import { z } from 'zod'

import type { LyricsThemeId } from '@/lib/lyrics-themes'
import {
  DEFAULT_LYRICS_CUSTOM_HUE,
  DEFAULT_LYRICS_THEME_ID,
  LYRICS_THEME_IDS,
  RETIRED_LYRICS_THEME_IDS,
} from '@/lib/lyrics-themes'
import { touchPref } from '@/lib/prefs/storage'

// The three screens a style is seen on. Phone landscape is the `short` variant in globals.css
export const LYRICS_SURFACES = ['desktop', 'landscape', 'portrait'] as const
export type LyricsSurface = (typeof LYRICS_SURFACES)[number]
export type ScreenSizes = Record<LyricsSurface, number>

// Everything the viewer can tune about how a song's lyrics look and sit on the video. One style serves all
// three screens: each screen's base type size is a fixed share of its own stage (--text-lyric), so one
// `fontSize` reads the same everywhere, and the position is a fraction of the space the lyrics move in
export interface LyricsStyle {
  // 1 is the screen's base size
  fontSize: number
  themeId: LyricsThemeId
  customHue: number
  // Over the video, on desktop and phone landscape: 0 pins the lyrics block to the top of the stage, 1 to the
  // bottom. Both show the same 16:9 picture, so one fraction clears the same burned-in subtitles on both
  anchor: number
  // In portrait the lyrics have their own band under the video, so they keep their own place in it: by
  // default its top, right under the video
  anchorPortrait: number
  // Two Lines' translation, in its own room at the top of the stage: 0 its top, 1 its bottom
  translationAnchor: number
  // The karaoke two-row layout, as a karaoke machine shows it: the top row's line starts at the left and the
  // next row's, waiting unfilled, ends at the right, with the sung line's translation alone at the top.
  // Desktop and phone landscape
  twoLines: boolean
  // Two lines' own size, kept apart from the one-line size: a share of the one-line base size
  fontSizeTwoLines: number
  // An optional extra factor on `fontSize` for one screen only; 1 leaves that screen at the shared size
  screenSizes: ScreenSizes
}

export const SCREEN_SIZE_MIN = 0.6
export const SCREEN_SIZE_MAX = 1.5

// The size slider's ends for each layout. Two lines sit side by side, so they get smaller type than one
// centred line, on a narrower range whose smallest end still reads over a video
export const FONT_SIZE_RANGE = { max: 1.6, min: 0.4 } as const
export const TWO_LINES_SIZE_RANGE = { max: 1.1, min: 0.6 } as const

interface SizeRange {
  min: number
  max: number
}

// How far each screen lets the size go. A desktop takes the whole range. A phone on its side a narrower one: its
// stage is short, so the largest sizes cover the picture and the smallest can't be read. An upright phone's
// full-screen player a little either way of its base, which already fills its narrow column (the lyrics under the
// video on the watch page keep one fixed size, and Lyrics Style offers no Size there)
const SCREEN_SIZE_RANGE: Record<
  LyricsSurface,
  { oneLine: SizeRange; twoLines: SizeRange } | null
> = {
  desktop: null,
  landscape: {
    oneLine: { max: 1.4, min: 0.6 },
    twoLines: { max: 1.05, min: 0.6 },
  },
  portrait: {
    oneLine: { max: 1.2, min: 0.85 },
    twoLines: { max: 1.2, min: 0.85 },
  },
}

// The slider's ends on a screen, for one line or two
export const sizeRangeOn = (
  surface: LyricsSurface,
  twoLines: boolean
): SizeRange => {
  const range = SCREEN_SIZE_RANGE[surface]
  if (range === null) {
    return twoLines ? TWO_LINES_SIZE_RANGE : FONT_SIZE_RANGE
  }
  return twoLines ? range.twoLines : range.oneLine
}

// The rows a lyric line shows with it: the Japanese (Lyrics), its romaji and its translation
export interface ShownLyricRows {
  lyrics: boolean
  romaji: boolean
  translation: boolean
}

// Hiding rows frees room the size slider can't reach, as its top end is set for all three rows. The rows still
// shown grow by a step per row hidden, keeping their sizes' ratios, so a lone row reads as the lead: romaji alone
// at about the Japanese's size (0.8 x 1.25), a translation alone just under it (0.7 x 1.3). Measured to stay within
// what all three rows take at the same size, so nothing grows past what the slider already allows. Two lines
// share the boost of their rows (Japanese and romaji); their translation hangs apart and keeps its size. Keyed
// Japanese, romaji, translation
const ROWS_BOOST: Record<`${0 | 1}${0 | 1}${0 | 1}`, number> = {
  '000': 1,
  '001': 1.3,
  '010': 1.25,
  '011': 1.15,
  '100': 1.2,
  '101': 1.1,
  '110': 1.1,
  '111': 1,
}
const TWO_LINES_ROWS_BOOST: Record<`${0 | 1}${0 | 1}`, number> = {
  '00': 1,
  '01': 1.25,
  '10': 1.15,
  '11': 1,
}
const bit = (shown: boolean) => (shown ? '1' : '0')
export const rowsBoost = (shown: ShownLyricRows, twoLines: boolean) =>
  twoLines
    ? TWO_LINES_ROWS_BOOST[`${bit(shown.lyrics)}${bit(shown.romaji)}`]
    : ROWS_BOOST[
        `${bit(shown.lyrics)}${bit(shown.romaji)}${bit(shown.translation)}`
      ]

// The lyrics' scale on a screen: the saved size times that screen's own tweak, held to what the screen allows
export const lyricsScaleOn = (
  surface: LyricsSurface,
  twoLines: boolean,
  size: number,
  screenSize: number
) => {
  const scale = size * screenSize
  if (SCREEN_SIZE_RANGE[surface] === null) {
    return scale
  }
  const { min, max } = sizeRangeOn(surface, twoLines)
  return Math.min(max, Math.max(min, scale))
}

// The size a viewer who never moved the slider starts at (the owner, 2026-10-27: at the base size one line over the
// video read as the largest it could be, worst on a phone on its side): 65% of the base on a touch screen, 80% with
// a mouse (0.94 × desktop's 0.85). A device's input, not its user agent; a size someone set, and a shared link's,
// are saved values and never read this
const FIRST_SIZE = { mouse: 0.94, touch: 0.65 } as const
const firstSize = () =>
  typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches
    ? FIRST_SIZE.mouse
    : FIRST_SIZE.touch

export const DEFAULT_LYRICS_STYLE: LyricsStyle = {
  anchor: 1,
  anchorPortrait: 0,
  customHue: DEFAULT_LYRICS_CUSTOM_HUE,
  fontSize: firstSize(),
  fontSizeTwoLines: 0.85,
  // Desktop starts a size down: at 100% one line spans most of a wide stage
  screenSizes: { desktop: 0.85, landscape: 1, portrait: 1 },
  themeId: DEFAULT_LYRICS_THEME_ID,
  translationAnchor: 0,
  twoLines: false,
}

// A song keeps only the fields the viewer changed for it; the rest follow the defaults
export type LyricsStyleOverrides = Partial<LyricsStyle>

// A retired preset's id reads as the preset that replaced it
export const lyricsThemeIdSchema = z.preprocess(
  (value) =>
    typeof value === 'string'
      ? (RETIRED_LYRICS_THEME_IDS[value] ?? value)
      : value,
  z.enum(LYRICS_THEME_IDS)
)

const unit = z.number().min(0).max(1)
const screenSize = z.number().min(SCREEN_SIZE_MIN).max(SCREEN_SIZE_MAX)
export const screenSizesSchema = z.object({
  desktop: screenSize,
  landscape: screenSize,
  portrait: screenSize,
})
// Every field optional: a saved record keeps what it had when it was saved, and fields added since (twoLines,
// screenSizes, fontSizeTwoLines) read as absent, so records from before them load unchanged. A field
// dropped since (stagger, backdrop) is left out of what loads
const styleFieldsSchema = z
  .object({
    anchor: unit,
    anchorPortrait: unit,
    customHue: z.number().min(0).max(359),
    fontSize: z.number().min(FONT_SIZE_RANGE.min).max(FONT_SIZE_RANGE.max),
    fontSizeTwoLines: z
      .number()
      .min(TWO_LINES_SIZE_RANGE.min)
      .max(TWO_LINES_SIZE_RANGE.max),
    screenSizes: screenSizesSchema,
    themeId: lyricsThemeIdSchema,
    translationAnchor: unit,
    twoLines: z.boolean(),
  })
  .partial()
const songStyleSchema = z.object({
  style: styleFieldsSchema,
  // When this device last changed the song's style, so a later cross-device sync can keep the newest
  updatedAt: z.number(),
  v: z.literal(1),
})

const songStyleKey = (videoId: string) => `lyricsStyle:${videoId}`

export const readSongStyle = (videoId: string): LyricsStyleOverrides => {
  try {
    const raw = localStorage.getItem(songStyleKey(videoId))
    if (raw === null) {
      return {}
    }
    const parsed = songStyleSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data.style : {}
  } catch {
    return {}
  }
}

export const writeSongStyle = (
  videoId: string,
  style: LyricsStyleOverrides
) => {
  try {
    if (Object.keys(style).length === 0) {
      localStorage.removeItem(songStyleKey(videoId))
    } else {
      localStorage.setItem(
        songStyleKey(videoId),
        JSON.stringify({ style, updatedAt: Date.now(), v: 1 })
      )
    }
    touchPref(songStyleKey(videoId))
  } catch {
    // Storage full or blocked: the style still applies for this visit
  }
}

// A shared link carries the sender's whole style as ?style=1.<theme>.<backdrop>.<size%>.<anchor%>.<portrait%>.<hue>,
// the backdrop always `shadow` now that it is the only one (an older app reads it; one from before reads Fade or Box
// and lands on the same look);
// short enough to sit in a chat message. The leading number is the format's version: 3 is two lines, with
// their own size as a last field. A style on one line still goes out as 1, which any app version can read.
// 2 (a last field: 0 one line, 1 two centred lines, 2 two staggered lines) is read, never written
const SHARE_SEPARATOR = '.'
const percent = (value: number) => Math.round(value * 100)

export const encodeSharedStyle = (style: SharedLyricsStyle) => {
  const fields = [
    style.themeId,
    'shadow',
    percent(style.fontSize),
    percent(style.anchor),
    percent(style.anchorPortrait),
    Math.round(style.customHue),
  ]
  return (
    style.twoLines
      ? [3, ...fields, percent(style.fontSizeTwoLines)]
      : [1, ...fields]
  ).join(SHARE_SEPARATOR)
}

const sharedFields = [
  lyricsThemeIdSchema,
  z.enum(['shadow', 'band', 'box']),
  z.coerce.number().int().min(40).max(160),
  z.coerce.number().int().min(0).max(100),
  z.coerce.number().int().min(0).max(100),
  z.coerce.number().int().min(0).max(359),
] as const
const sharedStyleSchema = z
  .union([
    z.tuple([z.literal('1'), ...sharedFields]),
    z.tuple([z.literal('2'), ...sharedFields, z.enum(['0', '1', '2'])]),
    z.tuple([
      z.literal('3'),
      ...sharedFields,
      z.coerce
        .number()
        .int()
        .min(percent(TWO_LINES_SIZE_RANGE.min))
        .max(percent(TWO_LINES_SIZE_RANGE.max)),
    ]),
  ])
  .transform(
    ([, themeId, , size, anchor, anchorPortrait, customHue, last]) => ({
      anchor: anchor / 100,
      anchorPortrait: anchorPortrait / 100,
      customHue,
      fontSize: size / 100,
      // Only format 3's last field is a number, the two-line size
      fontSizeTwoLines:
        typeof last === 'number'
          ? last / 100
          : DEFAULT_LYRICS_STYLE.fontSizeTwoLines,
      themeId,
      twoLines: typeof last === 'number' || last === '1' || last === '2',
    })
  )

// What a link passes on: the look and the place, not the receiver's per-screen size tweaks (nor, as links
// predate it, where Two Lines' translation sits)
export type SharedLyricsStyle = Omit<
  LyricsStyle,
  'screenSizes' | 'translationAnchor'
>

export const decodeSharedStyle = (
  raw: string | null
): SharedLyricsStyle | null => {
  if (raw === null) {
    return null
  }
  const parsed = sharedStyleSchema.safeParse(raw.split(SHARE_SEPARATOR))
  return parsed.success ? parsed.data : null
}

export const sameLyricsStyle = (a: SharedLyricsStyle, b: SharedLyricsStyle) =>
  encodeSharedStyle(a) === encodeSharedStyle(b)
