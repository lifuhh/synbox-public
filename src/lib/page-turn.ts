// Lock Landscape on a screen that cannot lock its orientation (an iPhone) turns the page a quarter clockwise
// while the screen stands upright, so a phone held on its side (top to the left) shows it the right way up.
// See html[data-landscape-lock] in globals.css. Pointer positions and boxes from the browser stay in the
// screen's axes; code that measures a drag or a press position converts them here
export const LANDSCAPE_LOCK_ATTR = 'data-landscape-lock'

export const pageTurned = () =>
  document.documentElement.hasAttribute(LANDSCAPE_LOCK_ATTR) &&
  matchMedia('(orientation: portrait)').matches

interface Point {
  x: number
  y: number
}

// The page's x runs down the screen, and its y from the screen's right edge to its left
export const pagePoint = ({
  clientX,
  clientY,
}: {
  clientX: number
  clientY: number
}): Point =>
  pageTurned()
    ? { x: clientY, y: window.innerWidth - clientX }
    : { x: clientX, y: clientY }

// Where a press landed across an element, 0 at its left edge and 1 at its right, in the page's axes
export const fractionAcross = (
  point: { clientX: number; clientY: number },
  element: Element
) => {
  const box = element.getBoundingClientRect()
  return pageTurned()
    ? (point.clientY - box.top) / box.height
    : (point.clientX - box.left) / box.width
}

// An element's fractional width along the page (offsetWidth rounds)
export const pageWidth = (element: Element) => {
  const box = element.getBoundingClientRect()
  return pageTurned() ? box.height : box.width
}
