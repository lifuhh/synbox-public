// Lyrics are white until sung; a theme sets the colour the karaoke wipe paints and the glow behind every line.
// The accent is the lit, sung part, so it sits near the white's lightness (OKLCH 0.86+) rather than darker than it.
// Presets are WCAG-checked: accent >= 13:1 on the fixed dark edge (.lyric-text-line), glow >= 3:1 darker than the white
export const LYRICS_THEME_IDS = [
  'sakura',
  'cinema',
  'amethyst',
  'aqua',
  'matcha',
  'lemon',
  'sunset',
  'custom',
] as const
export type LyricsThemeId = (typeof LYRICS_THEME_IDS)[number]

export const LYRICS_BACKDROP_IDS = ['shadow', 'band', 'box'] as const
export type LyricsBackdrop = (typeof LYRICS_BACKDROP_IDS)[number]

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
    accent: '#FFBBD2',
    glow: '#CA1960',
    id: 'sakura',
    name: 'Sakura',
  },
  {
    accent: '#B6D3FE',
    glow: 'transparent',
    id: 'cinema',
    name: 'Cinema',
  },
  {
    accent: '#D5C7FE',
    glow: '#8A4DFF',
    id: 'amethyst',
    name: 'Amethyst',
  },
  {
    accent: '#71E3FF',
    glow: '#0A8FB0',
    id: 'aqua',
    name: 'Aqua',
  },
  {
    accent: '#7FED9E',
    glow: '#1E9450',
    id: 'matcha',
    name: 'Matcha',
  },
  {
    accent: '#FFE15A',
    glow: '#B87500',
    id: 'lemon',
    name: 'Lemon',
  },
  {
    accent: '#FEC29F',
    glow: '#E0521A',
    id: 'sunset',
    name: 'Sunset',
  },
]

// Only the hue is user-chosen; fixed OKLCH lightness/chroma keep every hue at preset contrast
export const getCustomThemeColors = (hue: number): LyricsThemeColors => ({
  accent: `oklch(0.86 0.1 ${hue})`,
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

export const LYRICS_BACKDROPS: {
  id: LyricsBackdrop
  name: string
  hint: string
}[] = [
  {
    hint: 'Soft dark edge, like streaming subtitles',
    id: 'shadow',
    name: 'Shadow',
  },
  {
    hint: 'Darkens the video behind the lyrics',
    id: 'band',
    name: 'Fade',
  },
  {
    hint: 'Solid box, easiest to read',
    id: 'box',
    name: 'Box',
  },
]
