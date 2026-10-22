import { flushSync } from 'react-dom'

// How a layout change moves instead of jumping: `turn-in` and `turn-out` rotate the page a quarter as Lock
// Landscape turns it on an upright iPhone and back (`turn-back` from the flipped side), `flip` a half turn
// between its two sides; a phone turned by hand is rotated by the system, not here. `zoom` grows the video into
// the full-screen player and back. See html[data-transition] in globals.css
export type LayoutTransition =
  | 'turn-in'
  | 'turn-out'
  | 'turn-back'
  | 'flip'
  | 'zoom'

// Runs `update` (a React state change) inside a view transition: the browser snapshots the page, React renders
// the new layout at once, and the two animate between. Without view transitions (before iOS 18) or with reduced
// motion asked for, the change is instant as before
export const transitionLayout = (
  kind: LayoutTransition,
  update: () => void
) => {
  if (
    typeof document.startViewTransition !== 'function' ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    update()
    return
  }
  const root = document.documentElement
  root.dataset.transition = kind
  // A quarter turn swaps the page's width and height: the turning snapshot shrinks by their ratio to stay on screen
  root.style.setProperty('--turn-scale', String(innerWidth / innerHeight))
  const transition = document.startViewTransition(() => {
    flushSync(update)
  })
  const settle = async () => {
    try {
      await transition.finished
    } finally {
      delete root.dataset.transition
      root.style.removeProperty('--turn-scale')
    }
  }
  void settle()
}
