// Home's refresh. Tapping Home at the top (tab-bar.tsx), with no update waiting, asks the landing page to refresh
// its three lists; the page draws the pull-down spinner while it does (home-refresh.tsx)

let listener: (() => void) | null = null

// The landing page takes the requests while it shows
export const onHomeRefresh = (next: () => void) => {
  listener = next
  return () => {
    if (listener === next) {
      listener = null
    }
  }
}

// False when Home isn't showing to take it
export const requestHomeRefresh = () => {
  if (listener === null) {
    return false
  }
  listener()
  return true
}

// The lists are fetched again at most this often, however often Home is tapped; between, the recommendations
// and the gallery are only reshuffled. The chart's proxy lets a browser keep its answer this long anyway
// (netlify/youtube-proxy.ts › cacheHeaders), so a sooner fetch would get the same chart back
export const REFETCH_AFTER_MS = 5 * 60 * 1000

// `fetchedAt`: when a list was last fetched (0 if it never was)
export const shouldRefetch = (now: number, fetchedAt: number) =>
  now - fetchedAt >= REFETCH_AFTER_MS
