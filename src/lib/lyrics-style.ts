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

// How far each screen lets the size go. A desktop takes the whole range. A phone on its side only a narrow
// one: its stage is short, so a big size covers the picture and a small one can't be read. An upright phone
// none: one size fits its narrow column, and the Size slider is not offered there
const SCREEN_SIZE_RANGE: Record<
  LyricsSurface,
  { oneLine: SizeRange; twoLines: SizeRange } | null
> = {
  desktop: null,
  landscape: {
    oneLine: { max: 1.25, min: 0.8 },
    twoLines: { max: 1, min: 0.75 },
  },
  portrait: { oneLine: { max: 1, min: 1 }, twoLines: { max: 1, min: 1 } },
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

export const DEFAULT_LYRICS_STYLE: LyricsStyle = {
  anchor: 1,
  anchorPortrait: 0,
  customHue: DEFAULT_LYRICS_CUSTOM_HUE,
  fontSize: 1,
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

// Named styles the viewer saved to reuse ("My Styles"), on this device. Each holds a whole style
export interface LyricsTemplate {
  id: string
  name: string
  style: LyricsStyle
  savedAt: number
}
export const MAX_LYRICS_TEMPLATES = 12
export const TEMPLATE_NAME_MAX = 24
const TEMPLATES_KEY = 'lyricsTemplates'
const templatesSchema = z.object({
  templates: z.array(z.unknown()),
  v: z.literal(1),
})
// Checked one by one, so one bad record drops only itself
const templateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(TEMPLATE_NAME_MAX),
  savedAt: z.number(),
  style: styleFieldsSchema,
})

export const readLyricsTemplates = (): LyricsTemplate[] => {
  try {
    const parsed = templatesSchema.safeParse(
      JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? 'null')
    )
    return parsed.success
      ? parsed.data.templates.flatMap((raw) => {
          const template = templateSchema.safeParse(raw)
          return template.success
            ? [
                {
                  ...template.data,
                  style: { ...DEFAULT_LYRICS_STYLE, ...template.data.style },
                },
              ]
            : []
        })
      : []
  } catch {
    return []
  }
}

export const writeLyricsTemplates = (templates: readonly LyricsTemplate[]) => {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify({ templates, v: 1 }))
    touchPref(TEMPLATES_KEY)
  } catch {
    // Storage full or blocked: the templates still apply for this visit
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

// Whether the style on screen is a saved one. Fields that change nothing in a style don't count: the hue
// away from the Custom colour, and the two-line size on one line (the share code already leaves it out)
export const sameSavedLyricsStyle = (a: LyricsStyle, b: LyricsStyle) => {
  const shown = (style: LyricsStyle) => ({
    ...style,
    customHue: style.themeId === 'custom' ? style.customHue : 0,
  })
  return (
    sameLyricsStyle(shown(a), shown(b)) &&
    LYRICS_SURFACES.every(
      (surface) => a.screenSizes[surface] === b.screenSizes[surface]
    )
  )
}
