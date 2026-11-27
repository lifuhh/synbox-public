import { useEffect } from 'react'

// iOS 26 and 27 (WebKit; seen on an iPhone in Safari and the installed app, 2026-11): on a page with
// viewport-fit=cover held on its side, a cross-origin iframe's contents are drawn shifted right by the left safe-area
// inset and cut off at the iframe's right edge, whichever side the camera is on. YouTube's picture on the full-screen
// player showed a ~62pt black band on the left; our boxes measure where they should. Without cover the browser keeps
// the page out of the side insets and the shift goes, so the player drops cover while it is on its side (the
// turned page stands upright and keeps it). The cost: Zoom stops at the insets instead of the screen's edges. Safe
// either way once WebKit fixes it; remove it then to get the edges back. Detected by -webkit-touch-callout, iOS's own
// property (the lab's WebKit lacks it, and the bug)
export const VIEWPORT_CONTAIN_ATTR = 'data-viewport-contain'

// Without cover until the cleanup
const contain = (meta: HTMLMetaElement) => {
  const cover = meta.content
  meta.content = cover.replace(/,\s*viewport-fit=cover/u, '')
  document.documentElement.setAttribute(VIEWPORT_CONTAIN_ATTR, '')
  return () => {
    meta.content = cover
    document.documentElement.removeAttribute(VIEWPORT_CONTAIN_ATTR)
  }
}

export const useViewportContain = (on: boolean) => {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="viewport"]'
    )
    return on && meta !== null && CSS.supports('-webkit-touch-callout', 'none')
      ? contain(meta)
      : undefined
  }, [on])
}
