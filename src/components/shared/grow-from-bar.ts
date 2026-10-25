import {
  growEngine,
  predictedStage,
} from '@/components/player-stage/youtube-engine'
import type { ScreenBox } from '@/components/player-stage/youtube-engine'
import { GROW_MS, runGrow } from '@/lib/grow'
import { reducedMotion } from '@/lib/reduced-motion'

import { THUMB_RADIUS_PX } from './mini-bar-view'

// The tap on the mini bar, until the player page takes it (use-drag-to-minimise.ts › growFromBar): when it began and
// the thumbnail the video grows out of, and whether the video could start moving then
export interface Grow {
  startedAt: number
  to: ScreenBox
  moved: boolean
}
let pending: Grow | null = null
let unclaimed = 0

// The page under the tabs, faded out over the grow's first half: the player fades in over its second
const pageContent = () => document.querySelector('[data-page-content]')

const stopAll = (element: Element | null) => {
  for (const animation of element?.getAnimations() ?? []) {
    animation.cancel()
  }
}

// What the player page joins once it shows; null when no tap is under way (Back to a resumed song, a link)
export const takeGrow = (): Grow | null => {
  const taken = pending
  pending = null
  clearTimeout(unclaimed)
  return taken
}

// Ends what the tap started on the page left behind, once the player page has its own
export const releaseGrowPage = () => {
  stopAll(pageContent())
}

// The tap itself: everything that can move before the player page exists starts now, as compositor animations, so
// a page that takes a while to render no longer holds the first frame. The video grows from the thumbnail toward
// where the stage last laid it, the tabs and the bar fade, and the page under them fades out. Then `go` opens the
// player two frames later, once they are moving on screen
export const growFromBar = (thumb: HTMLElement, go: () => void) => {
  if (reducedMotion()) {
    go()
    return
  }
  const startedAt = performance.now()
  const to = thumb.getBoundingClientRect()
  const stage = predictedStage()
  const moved =
    stage !== null &&
    growEngine({ from: stage, to }, startedAt, THUMB_RADIUS_PX) !== null
  pending = { moved, startedAt, to }
  const dock = document.querySelector('[data-tabbar-root]')
  if (dock !== null) {
    runGrow(dock, (t) => ({ opacity: t }), startedAt)
  }
  const page = pageContent()
  if (page !== null) {
    runGrow(page, (t) => ({ opacity: Math.max(0, 2 * t - 1) }), startedAt)
  }
  // A player page that never comes (the tap went nowhere) mustn't leave the page faded out
  unclaimed = window.setTimeout(() => {
    pending = null
    stopAll(page)
    stopAll(dock)
  }, GROW_MS * 6)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(go, 0)
    })
  })
}
