// How one page change moves (app-router.tsx runs it, globals.css › html[data-nav] draws it):
// - `fade`: a 150ms cross-fade. Tab to tab, any page change with a mouse, and anything to or from the player,
//   whose video is laid over the page by script and can't ride a sliding snapshot
// - `push` / `pop`: on a touch screen, a page deeper in slides in from the right over the one it came from, and
//   slides back off on the way out, as a phone's own apps do
// - `none`: nothing to animate, or something else already did
export type NavKind = 'none' | 'fade' | 'push' | 'pop'

const PLAYER = /^\/v\/[^/]+\/?$/u

// How deep a page sits under the tabs: the tab pages 0, pages opened from them 1, pages opened from those 2
const DEPTHS: [RegExp, number][] = [
  [/^\/(?:search|library|you)?\/?$/u, 0],
  [/^\/playlists\/[^/]+/u, 2],
  [/^\/v\/[^/]+\/versions/u, 2],
]
export const depthOf = (pathname: string) =>
  DEPTHS.find(([pattern]) => pattern.test(pathname))?.[1] ?? 1

export const isTabRoot = (pathname: string) => depthOf(pathname) === 0

export const navKind = ({
  from,
  to,
  replace,
  osAnimated,
  touch,
  reducedMotion,
}: {
  from: string
  to: string
  // The address was tidied in place (a redirect), not a page the viewer asked for
  replace: boolean
  // The browser drew the change itself: a swipe back on iOS, Android's predictive back, a trackpad swipe
  osAnimated: boolean
  touch: boolean
  reducedMotion: boolean
}): NavKind => {
  if (from === to || replace || osAnimated) {
    return 'none'
  }
  const fromPlayer = PLAYER.test(from)
  const toPlayer = PLAYER.test(to)
  // Song to song: the one player stays and swaps its song
  if (fromPlayer && toPlayer) {
    return 'none'
  }
  if (fromPlayer || toPlayer || !touch || reducedMotion) {
    return 'fade'
  }
  const change = depthOf(to) - depthOf(from)
  if (change === 0) {
    return 'fade'
  }
  return change > 0 ? 'push' : 'pop'
}
