import type { CSSProperties } from 'react'

// Lyrics are white until sung; a theme sets the colour the karaoke wipe paints and the glow behind every line.
// Presets are WCAG-checked: accent >= 8:1 on the fixed dark edge (.lyric-text-line), glow >= 3:1 darker than the white
export type LyricsThemeId =
  | 'sakura'
  | 'cinema'
  | 'amethyst'
  | 'aqua'
  | 'matcha'
  | 'lemon'
  | 'sunset'
  | 'custom'

export type LyricsBackdrop = 'shadow' | 'band' | 'box'

export interface LyricsThemeColors {
  accent: string
  glow: string
}

export interface LyricsTheme extends LyricsThemeColors {
  id: LyricsThemeId
  name: string
}

export const DEFAULT_LYRICS_THEME_ID: LyricsThemeId = 'sakura'
export const DEFAULT_LYRICS_BACKDROP: LyricsBackdrop = 'shadow'
export const DEFAULT_LYRICS_CUSTOM_HUE = 200

export const LYRICS_THEMES: LyricsTheme[] = [
  {
    id: 'sakura',
    name: 'Sakura',
    accent: '#FF8FBA',
    glow: '#CA1960',
  },
  {
    id: 'cinema',
    name: 'Cinema',
    accent: '#6EA8FF',
    glow: 'transparent',
  },
  {
    id: 'amethyst',
    name: 'Amethyst',
    accent: '#BBA0FF',
    glow: '#8A4DFF',
  },
  {
    id: 'aqua',
    name: 'Aqua',
    accent: '#5ED6F2',
    glow: '#0A8FB0',
  },
  {
    id: 'matcha',
    name: 'Matcha',
    accent: '#7FE09A',
    glow: '#1E9450',
  },
  {
    id: 'lemon',
    name: 'Lemon',
    accent: '#FFE15A',
    glow: '#B87500',
  },
  {
    id: 'sunset',
    name: 'Sunset',
    accent: '#FFA36B',
    glow: '#E0521A',
  },
]

// Only the hue is user-chosen; fixed OKLCH lightness/chroma keep every hue at preset contrast
export const getCustomThemeColors = (hue: number): LyricsThemeColors => ({
  accent: `oklch(0.82 0.12 ${hue})`,
  glow: `oklch(0.58 0.19 ${hue})`,
})

export const getLyricsThemeColors = (
  themeId: LyricsThemeId,
  customHue: number
): LyricsThemeColors => {
  if (themeId === 'custom') {
    return getCustomThemeColors(customHue)
  }
  return LYRICS_THEMES.find((theme) => theme.id === themeId) ?? LYRICS_THEMES[0]
}

type LyricsThemeCssVars = CSSProperties &
  Record<'--lyric-accent' | '--lyric-glow', string>

export const getLyricsThemeCssVars = (
  colors: LyricsThemeColors
): LyricsThemeCssVars => ({
  '--lyric-accent': colors.accent,
  '--lyric-glow': colors.glow,
})

export const LYRICS_BACKDROPS: {
  id: LyricsBackdrop
  name: string
  hint: string
}[] = [
  {
    id: 'shadow',
    name: 'Shadow',
    hint: 'Soft dark edge, like streaming subtitles',
  },
  {
    id: 'band',
    name: 'Fade',
    hint: 'Darkens the video behind the lyrics',
  },
  {
    id: 'box',
    name: 'Box',
    hint: 'Solid box, easiest to read',
  },
]
