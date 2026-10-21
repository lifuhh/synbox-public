import { useCallback, useSyncExternalStore } from 'react'

import type { LyricsSurface } from '@/lib/lyrics-style'

export const useMediaQuery = (query: string) => {
  const subscribe = useCallback(
    (listener: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', listener)
      return () => {
        list.removeEventListener('change', listener)
      }
    },
    [query]
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}

// The player lays its rail out as a row under the video in portrait, so menus from it open downward
export const usePortrait = () => useMediaQuery('(orientation: portrait)')

// Which of the three screens a lyrics style is seen on, matching the `portrait:` and `short:` variants
export const useLyricsSurface = (): LyricsSurface => {
  const portrait = usePortrait()
  const short = useMediaQuery(
    '(orientation: landscape) and (max-height: 500px)'
  )
  if (portrait) {
    return 'portrait'
  }
  return short ? 'landscape' : 'desktop'
}
