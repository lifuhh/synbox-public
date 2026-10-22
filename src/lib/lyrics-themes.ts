// Lyrics are white until sung; a theme sets the colour the karaoke wipe paints and the glow behind every line.
// The accent is the lit, sung part, so it sits near the white's lightness (OKLCH 0.86+) rather than darker than it.
// Presets are WCAG-checked: accent >= 13:1 on the fixed dark edge (.lyric-text-line), glow >= 3:1 darker than the white.
// Frost, the default, is a pale blue: across the hue wheel from the app's magenta, and quiet enough to sit beside it
export const LYRICS_THEME_IDS = [
  'frost',
  'cinema',
  'amethyst',
  'sunset',
  'matcha',
  'lemon',
  'sakura',
  'custom',
] as const
export type LyricsThemeId = (typeof LYRICS_THEME_IDS)[number]

// Retired ids and the preset that took their place. Saved styles, synced settings and shared links made before
// still name them
export const RETIRED_LYRICS_THEME_IDS: Readonly<Record<string, LyricsThemeId>> =
  {
    aqua: 'frost',
  }

export interface LyricsThemeColors {
  accent: string
  glow: string
}

export interface LyricsTheme extends LyricsThemeColors {
  id: LyricsThemeId
  name: string
}

export const DEFAULT_LYRICS_THEME_ID: LyricsThemeId = 'frost'
export const DEFAULT_LYRICS_CUSTOM_HUE = 200

export const LYRICS_THEMES: LyricsTheme[] = [
  {
    accent: '#92DFF2',
    glow: '#0A80B0',
    id: 'frost',
    name: 'Frost',
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
    accent: '#FEC29F',
    glow: '#E0521A',
    id: 'sunset',
    name: 'Sunset',
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
    accent: '#FFBBD2',
    glow: '#CA1960',
    id: 'sakura',
    name: 'Sakura',
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
