import { useCallback, useSyncExternalStore } from 'react'

import type { LyricsSurface } from '@/lib/lyrics-style'

import { usePageTurned } from './use-landscape-lock'

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

// The player lays its rail out as a row under the video in portrait, so menus from it open downward. A page
// turned on its side by Lock Landscape lays out as landscape on an upright screen
export const usePortrait = () => {
  const portrait = useMediaQuery('(orientation: portrait)')
  const turned = usePageTurned()
  return portrait && !turned
}

// Which of the three screens a lyrics style is seen on, matching the `portrait:` and `short:` variants (a
// phone's page turned by Lock Landscape counts as short, as in globals.css)
export const useLyricsSurface = (): LyricsSurface => {
  const portrait = usePortrait()
  const short = useMediaQuery(
    '(orientation: landscape) and (max-height: 500px)'
  )
  const upright = useMediaQuery(
    '(orientation: portrait) and (max-width: 500px)'
  )
  const turned = usePageTurned()
  if (portrait) {
    return 'portrait'
  }
  return short || (upright && turned) ? 'landscape' : 'desktop'
}
