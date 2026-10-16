import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

import type { LyricsBackdrop, LyricsThemeId } from '@/lib/lyricsThemes'
import {
  DEFAULT_LYRICS_BACKDROP,
  DEFAULT_LYRICS_CUSTOM_HUE,
  DEFAULT_LYRICS_THEME_ID,
} from '@/lib/lyricsThemes'
import type { CurrentPlayingInfo } from '@/types'

export const mutedAtom = atom(true)

export const lyricsVisibilityAtom = atom(true)
export const romajiVisibilityAtom = atom(true)
export const translationVisibilityAtom = atom(true)
export const translationIsEnglishAtom = atom(true)
export const lyricsDisplayBottomAtom = atom(true)

const DEFAULT_FONT_SIZE = 1
const getInitialFontSize = () => {
  const stored = localStorage.getItem('fontSizeMultiplier')
  return stored ? parseFloat(stored) : DEFAULT_FONT_SIZE
}
export const fontSizeMultiplierAtom = atom(getInitialFontSize())

export const fontSizeMultiplierAtomWithPersistence = atom(
  (get) => get(fontSizeMultiplierAtom),
  (get, set, newValue: number) => {
    set(fontSizeMultiplierAtom, newValue)
    localStorage.setItem('fontSizeMultiplier', newValue.toString())
  }
)

export const lyricsThemeIdAtom = atomWithStorage<LyricsThemeId>(
  'lyricsTheme',
  DEFAULT_LYRICS_THEME_ID
)
export const lyricsCustomHueAtom = atomWithStorage<number>(
  'lyricsCustomHue',
  DEFAULT_LYRICS_CUSTOM_HUE
)
export const lyricsBackdropAtom = atomWithStorage<LyricsBackdrop>(
  'lyricsBackdrop',
  DEFAULT_LYRICS_BACKDROP
)

export const lyricsControlVisibilityAtom = atom(true)

export const dialogStepAtom = atom(0)

interface FavoriteItem {
  videoId: string
  title: string
  author: string
  thumbnailUrl: string
}

export const currentVideoAtom = atom<CurrentPlayingInfo | null>(null)
export const favoritesAtom = atomWithStorage<FavoriteItem[]>('favorites', [])
export const addFavoriteAtom = atom(
  null,
  (get, set, newFavorite: FavoriteItem) => {
    const favorites = get(favoritesAtom)
    set(favoritesAtom, [...favorites, newFavorite])
  }
)

export const removeFavoriteAtom = atom(null, (get, set, videoId: string) => {
  const favorites = get(favoritesAtom)
  set(
    favoritesAtom,
    favorites.filter((item) => item.videoId !== videoId)
  )
})

export const isFavoriteAtom = atom((get) => (videoId: string) => {
  const favorites = get(favoritesAtom)
  return favorites.some((item) => item.videoId === videoId)
})

interface HistoryItem {
  videoId: string
  title: string
  author: string
  thumbnailUrl: string
  timestamp: number
}

export const historyAtom = atomWithStorage<HistoryItem[]>('history', [])

export const addToHistoryAtom = atom(
  null,
  (get, set, newItem: Omit<HistoryItem, 'timestamp'>) => {
    const history = get(historyAtom)

    const filteredHistory = history.filter(
      (item) => item.videoId !== newItem.videoId
    )

    const updatedHistory = [
      {
        ...newItem,
        timestamp: Date.now(),
      },
      ...filteredHistory,
    ]

    const limitedHistory = updatedHistory.slice(0, 100)

    set(historyAtom, limitedHistory)
  }
)

export const showWatchHistoryToastAtom = atomWithStorage(
  'showWatchHistoryToast',
  true
)
