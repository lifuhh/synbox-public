import { z } from 'zod'

import type { LyricsBackdrop, LyricsThemeId } from '@/lib/lyrics-themes'
import {
  DEFAULT_LYRICS_BACKDROP,
  DEFAULT_LYRICS_CUSTOM_HUE,
  DEFAULT_LYRICS_THEME_ID,
  LYRICS_BACKDROP_IDS,
  LYRICS_THEME_IDS,
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
  backdrop: LyricsBackdrop
  // Over the video, on desktop and phone landscape: 0 pins the lyrics block to the top of the stage, 1 to the
  // bottom. Both show the same 16:9 picture, so one fraction clears the same burned-in subtitles on both
  anchor: number
  // In portrait the lyrics have their own band under the video, so they keep their own place in it
  anchorPortrait: number
  // The karaoke two-row layout: the next line waits, unfilled, in the other row. Desktop and phone landscape
  twoLines: boolean
  // With two lines, the top row's line starts at the left and the next row's ends at the right, as a karaoke
  // machine shows them, in smaller type, with the sung line's translation alone at the top
  stagger: boolean
  // An optional extra factor on `fontSize` for one screen only; 1 leaves that screen at the shared size
  screenSizes: ScreenSizes
}

export const SCREEN_SIZE_MIN = 0.6
export const SCREEN_SIZE_MAX = 1.5

export const DEFAULT_LYRICS_STYLE: LyricsStyle = {
  anchor: 1,
  anchorPortrait: 0.5,
  backdrop: DEFAULT_LYRICS_BACKDROP,
  customHue: DEFAULT_LYRICS_CUSTOM_HUE,
  fontSize: 1,
  screenSizes: { desktop: 1, landscape: 1, portrait: 1 },
  stagger: false,
  themeId: DEFAULT_LYRICS_THEME_ID,
  twoLines: false,
}

// A song keeps only the fields the viewer changed for it; the rest follow the defaults
export type LyricsStyleOverrides = Partial<LyricsStyle>

const unit = z.number().min(0).max(1)
const screenSize = z.number().min(SCREEN_SIZE_MIN).max(SCREEN_SIZE_MAX)
export const screenSizesSchema = z.object({
  desktop: screenSize,
  landscape: screenSize,
  portrait: screenSize,
})
// Every field optional: a saved record keeps what it had when it was saved, and fields added since (twoLines,
// screenSizes, stagger) read as absent, so records from before them load unchanged
const styleFieldsSchema = z
  .object({
    anchor: unit,
    anchorPortrait: unit,
    backdrop: z.enum(LYRICS_BACKDROP_IDS),
    customHue: z.number().min(0).max(359),
    fontSize: z.number().min(0.4).max(1.6),
    screenSizes: screenSizesSchema,
    stagger: z.boolean(),
    themeId: z.enum(LYRICS_THEME_IDS),
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
// short enough to sit in a chat message. The leading number is the format's version: 2 adds a last field, 1
// for two lines. A style on one line still goes out as 1, which an app version from before 2 can read
const SHARE_SEPARATOR = '.'
const percent = (value: number) => Math.round(value * 100)

export const encodeSharedStyle = (style: SharedLyricsStyle) => {
  const fields = [
    style.themeId,
    style.backdrop,
    percent(style.fontSize),
    percent(style.anchor),
    percent(style.anchorPortrait),
    Math.round(style.customHue),
  ]
  // Format 2's last field: 1 two centred lines, 2 two staggered lines
  return (
    style.twoLines ? [2, ...fields, style.stagger ? 2 : 1] : [1, ...fields]
  ).join(SHARE_SEPARATOR)
}

const sharedFields = [
  z.enum(LYRICS_THEME_IDS),
  z.enum(LYRICS_BACKDROP_IDS),
  z.coerce.number().int().min(40).max(160),
  z.coerce.number().int().min(0).max(100),
  z.coerce.number().int().min(0).max(100),
  z.coerce.number().int().min(0).max(359),
] as const
const sharedStyleSchema = z
  .union([
    z.tuple([z.literal('1'), ...sharedFields]),
    z.tuple([z.literal('2'), ...sharedFields, z.enum(['0', '1', '2'])]),
  ])
  .transform(
    ([
      ,
      themeId,
      backdrop,
      size,
      anchor,
      anchorPortrait,
      customHue,
      lines,
    ]) => ({
      anchor: anchor / 100,
      anchorPortrait: anchorPortrait / 100,
      backdrop,
      customHue,
      fontSize: size / 100,
      stagger: lines === '2',
      themeId,
      twoLines: lines === '1' || lines === '2',
    })
  )

// What a link passes on: the look and the place, not the receiver's per-screen size tweaks
export type SharedLyricsStyle = Omit<LyricsStyle, 'screenSizes'>

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
