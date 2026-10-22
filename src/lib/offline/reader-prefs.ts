/* oxlint-disable promise/prefer-await-to-then -- zod's .catch() sets a schema's fallback value; it is not a promise */
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { z } from 'zod'

import { syncedStorage } from '@/lib/prefs/storage'

// How the offline reader looks, kept on this device. Separate from the player's lyrics style: a page of
// text wants different sizes and colours from lyrics over a video
export const READER_SIZES = [0.85, 1, 1.15, 1.3, 1.5, 1.75] as const

// The Japanese line's colour. Ink is the page's own text colour; the rest are hues, drawn lighter on the
// dark page and darker on the light one so they read on both
export const READER_COLORS = [
  { hue: null, id: 'ink', label: 'Ink' },
  { hue: 10, id: 'rose', label: 'Rose' },
  { hue: 75, id: 'amber', label: 'Amber' },
  { hue: 235, id: 'sky', label: 'Sky' },
] as const

const readerPrefsSchema = z.object({
  bold: z.boolean().catch(false),
  color: z.enum(['ink', 'rose', 'amber', 'sky', 'custom']).catch('ink'),
  hue: z.number().min(0).max(360).catch(300),
  japanese: z.boolean().catch(true),
  language: z.enum(['en', 'zh']).catch('en'),
  // Synced plays the lyrics on a silent clock, Spotify style; reader is the plain page
  mode: z.enum(['synced', 'reader']).catch('synced'),
  romaji: z.boolean().catch(true),
  size: z
    .number()
    .int()
    .min(0)
    .max(READER_SIZES.length - 1)
    .catch(1),
  theme: z.enum(['dark', 'light']).catch('dark'),
  translation: z.boolean().catch(true),
})
export type ReaderPrefs = z.infer<typeof readerPrefsSchema>
export type ReaderTheme = ReaderPrefs['theme']
export type ReaderLayer = 'japanese' | 'romaji' | 'translation'

// Synced to a signed-in account like the lyrics style (src/lib/prefs)
const storedReaderPrefsAtom = atomWithStorage<unknown>(
  'offlineReader',
  {},
  syncedStorage(),
  { getOnInit: true }
)

const parsePrefs = (stored: unknown): ReaderPrefs =>
  readerPrefsSchema.parse(
    typeof stored === 'object' && stored !== null ? stored : {}
  )

export const readerPrefsAtom = atom(
  (get) => parsePrefs(get(storedReaderPrefsAtom)),
  (get, set, change: Partial<ReaderPrefs>) => {
    set(storedReaderPrefsAtom, {
      ...parsePrefs(get(storedReaderPrefsAtom)),
      ...change,
    })
  }
)

export const colorHue = (prefs: ReaderPrefs) =>
  prefs.color === 'custom'
    ? prefs.hue
    : (READER_COLORS.find((color) => color.id === prefs.color)?.hue ?? null)

// The Japanese line's colour on this page, or null for the page's text colour
export const accentColor = (theme: ReaderTheme, hue: number | null) => {
  if (hue === null) {
    return null
  }
  return theme === 'dark' ? `oklch(0.85 0.1 ${hue})` : `oklch(0.45 0.14 ${hue})`
}
