import { z } from 'zod'

import type { LyricsBackdrop, LyricsThemeId } from '@/lib/lyricsThemes'
import {
  DEFAULT_LYRICS_BACKDROP,
  DEFAULT_LYRICS_CUSTOM_HUE,
  DEFAULT_LYRICS_THEME_ID,
  LYRICS_BACKDROP_IDS,
  LYRICS_THEME_IDS,
} from '@/lib/lyricsThemes'

// Everything the viewer can tune about how a song's lyrics look and sit on the video
export interface LyricsStyle {
  fontSize: number
  themeId: LyricsThemeId
  customHue: number
  backdrop: LyricsBackdrop
  // 0 pins the lyrics block to the top of the stage, 1 to the bottom
  anchor: number
  // In portrait the lyrics have their own band under the video, so they keep their own place in it
  anchorPortrait: number
}

export const DEFAULT_LYRICS_STYLE: LyricsStyle = {
  anchor: 0.85,
  anchorPortrait: 0.5,
  backdrop: DEFAULT_LYRICS_BACKDROP,
  customHue: DEFAULT_LYRICS_CUSTOM_HUE,
  fontSize: 1,
  themeId: DEFAULT_LYRICS_THEME_ID,
}

// A song keeps only the fields the viewer changed for it; the rest follow the defaults
export type LyricsStyleOverrides = Partial<LyricsStyle>

const unit = z.number().min(0).max(1)
const songStyleSchema = z.object({
  style: z
    .object({
      anchor: unit,
      anchorPortrait: unit,
      backdrop: z.enum(LYRICS_BACKDROP_IDS),
      customHue: z.number().min(0).max(359),
      fontSize: z.number().min(0.4).max(1.6),
      themeId: z.enum(LYRICS_THEME_IDS),
    })
    .partial(),
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
      return
    }
    localStorage.setItem(
      songStyleKey(videoId),
      JSON.stringify({ style, updatedAt: Date.now(), v: 1 })
    )
  } catch {
    // Storage full or blocked: the style still applies for this visit
  }
}

// A shared link carries the sender's whole style as ?style=1.<theme>.<backdrop>.<size%>.<anchor%>.<portrait%>.<hue>,
// short enough to sit in a chat message. The leading 1 is the format's version
const SHARE_SEPARATOR = '.'
const percent = (value: number) => Math.round(value * 100)

export const encodeSharedStyle = (style: LyricsStyle) =>
  [
    1,
    style.themeId,
    style.backdrop,
    percent(style.fontSize),
    percent(style.anchor),
    percent(style.anchorPortrait),
    Math.round(style.customHue),
  ].join(SHARE_SEPARATOR)

const sharedStyleSchema = z
  .tuple([
    z.literal('1'),
    z.enum(LYRICS_THEME_IDS),
    z.enum(LYRICS_BACKDROP_IDS),
    z.coerce.number().int().min(40).max(160),
    z.coerce.number().int().min(0).max(100),
    z.coerce.number().int().min(0).max(100),
    z.coerce.number().int().min(0).max(359),
  ])
  .transform(
    ([, themeId, backdrop, size, anchor, anchorPortrait, customHue]) => ({
      anchor: anchor / 100,
      anchorPortrait: anchorPortrait / 100,
      backdrop,
      customHue,
      fontSize: size / 100,
      themeId,
    })
  )

export const decodeSharedStyle = (raw: string | null): LyricsStyle | null => {
  if (raw === null) {
    return null
  }
  const parsed = sharedStyleSchema.safeParse(raw.split(SHARE_SEPARATOR))
  return parsed.success ? parsed.data : null
}

export const sameLyricsStyle = (a: LyricsStyle, b: LyricsStyle) =>
  encodeSharedStyle(a) === encodeSharedStyle(b)
