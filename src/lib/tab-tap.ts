// What a tap on a tab-bar tab does. Another page's tab opens it. The current page's tab takes it back to the top,
// as iOS apps do; a refreshing tab (Home, Library), tapped again at the top (or twice in a row), refreshes its page,
// and Home also swaps in a downloaded update first if one waits (tab-bar.tsx)
export type TabTap = 'navigate' | 'scroll' | 'refresh' | 'update'

// Two taps closer than this are one double tap
export const DOUBLE_TAP_MS = 400

export const tabTap = ({
  current,
  home,
  refreshes,
  atTop,
  sinceLastTapMs,
}: {
  // The tab's own page is showing (not a page it is only the home of)
  current: boolean
  home: boolean
  // The tab's page refreshes on a tap at its top (Home, Library)
  refreshes: boolean
  atTop: boolean
  // Since the previous tap on this same tab while its page showed; Infinity if none
  sinceLastTapMs: number
}): TabTap => {
  if (!current) {
    return 'navigate'
  }
  if ((home || refreshes) && (atTop || sinceLastTapMs < DOUBLE_TAP_MS)) {
    return home ? 'update' : 'refresh'
  }
  // At the top, another tab's link does what it always did (Search drops its query)
  return atTop ? 'navigate' : 'scroll'
}
