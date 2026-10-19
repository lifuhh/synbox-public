import type { CSSProperties } from 'react'

// Presets are WCAG-checked: fill/secondary >= 13:1 on the fixed dark edge (.lyric-text-line), glow >= 3:1 darker than fill
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
  fill: string
  secondary: string
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
    fill: '#FFF4F8',
    secondary: '#FFC9DD',
    glow: '#CA1960',
  },
  {
    id: 'cinema',
    name: 'Cinema',
    fill: '#F5F5F5',
    secondary: '#D4D4D4',
    glow: 'transparent',
  },
  {
    id: 'amethyst',
    name: 'Amethyst',
    fill: '#F6F0FF',
    secondary: '#D9C7FF',
    glow: '#8A4DFF',
  },
  {
    id: 'aqua',
    name: 'Aqua',
    fill: '#EEFCFF',
    secondary: '#A8EEFA',
    glow: '#0A8FB0',
  },
  {
    id: 'matcha',
    name: 'Matcha',
    fill: '#F1FFF3',
    secondary: '#B9F0C6',
    glow: '#1E9450',
  },
  {
    id: 'lemon',
    name: 'Lemon',
    fill: '#FFE873',
    secondary: '#E6E1CC',
    glow: '#B87500',
  },
  {
    id: 'sunset',
    name: 'Sunset',
    fill: '#FFF3EA',
    secondary: '#FFC9A3',
    glow: '#E0521A',
  },
]

// Only the hue is user-chosen; fixed OKLCH lightness/chroma keep every hue at preset contrast
export const getCustomThemeColors = (hue: number): LyricsThemeColors => ({
  fill: `oklch(0.97 0.025 ${hue})`,
  secondary: `oklch(0.88 0.08 ${hue})`,
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
  Record<'--lyric-fill' | '--lyric-secondary' | '--lyric-glow', string>

export const getLyricsThemeCssVars = (
  colors: LyricsThemeColors
): LyricsThemeCssVars => ({
  '--lyric-fill': colors.fill,
  '--lyric-secondary': colors.secondary,
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
