// A tab page's refresh. Tapping its dock tab at the top (tab-bar.tsx), with no update waiting, asks the page showing
// under that tab to refresh; the page draws the pull-down spinner while it does (page-refresh.tsx). Home and Library
// take it
import { scrollMotion } from '@/lib/reduced-motion'

const listeners = new Map<string, () => void>()

// The page at `path` takes the requests while it shows
export const onPageRefresh = (path: string, next: () => void) => {
  listeners.set(path, next)
  return () => {
    if (listeners.get(path) === next) {
      listeners.delete(path)
    }
  }
}

// False when no page at `path` is showing to take it
export const requestPageRefresh = (path: string) => {
  const listener = listeners.get(path)
  if (listener === undefined) {
    return false
  }
  listener()
  return true
}

// What pressing the button for the page already showing does where there is no dock tab (the top bar's Library
// button on the Library page): at its top the page refreshes, else it goes back to the top. False when no page at
// `path` takes it
export const refreshOrScrollUp = (path: string) => {
  const scroller =
    document.querySelector<HTMLElement>('[data-scroll-top]') ??
    document.scrollingElement
  if ((scroller?.scrollTop ?? 0) > 2) {
    scroller?.scrollTo({ behavior: scrollMotion(), top: 0 })
    return true
  }
  return requestPageRefresh(path)
}

// The lists are fetched again at most this often, however often Home is tapped; between, the recommendations
// and the gallery are only reshuffled. The chart's proxy lets a browser keep its answer this long anyway
// (netlify/youtube-proxy.ts › cacheHeaders), so a sooner fetch would get the same chart back
export const REFETCH_AFTER_MS = 5 * 60 * 1000

// `fetchedAt`: when a list was last fetched (0 if it never was)
export const shouldRefetch = (now: number, fetchedAt: number) =>
  fetchedAt === 0 || now - fetchedAt >= REFETCH_AFTER_MS
