import { useCallback, useSyncExternalStore } from 'react'

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
