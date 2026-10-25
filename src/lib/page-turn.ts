// Lock Landscape on a screen that cannot lock its orientation (an iPhone) turns the page a quarter clockwise
// while the screen stands upright, so a phone held on its side (top to the left) shows it the right way up;
// Flip turns it the other way, for a phone held top to the right. See html[data-landscape-lock] in globals.css.
// Pointer positions and boxes from the browser stay in the screen's axes; code that measures a drag or a press
// position converts them here
export const LANDSCAPE_LOCK_ATTR = 'data-landscape-lock'
export const LANDSCAPE_FLIP_ATTR = 'data-landscape-flip'

export const pageTurned = () =>
  document.documentElement.hasAttribute(LANDSCAPE_LOCK_ATTR) &&
  matchMedia('(orientation: portrait)').matches

// Turned a quarter anticlockwise, top to the screen's left edge
export const pageFlipped = () =>
  document.documentElement.hasAttribute(LANDSCAPE_FLIP_ATTR)

interface Point {
  x: number
  y: number
}

// Turned clockwise, the page's x runs down the screen and its y from the screen's right edge to its left;
// flipped, its x runs up the screen and its y from the left edge to the right
export const pagePoint = ({
  clientX,
  clientY,
}: {
  clientX: number
  clientY: number
}): Point => {
  if (!pageTurned()) {
    return { x: clientX, y: clientY }
  }
  return pageFlipped()
    ? { x: window.innerHeight - clientY, y: clientX }
    : { x: clientY, y: window.innerWidth - clientX }
}

// Where a press landed across an element, 0 at its left edge and 1 at its right, in the page's axes
export const fractionAcross = (
  point: { clientX: number; clientY: number },
  element: Element
) => {
  const box = element.getBoundingClientRect()
  if (!pageTurned()) {
    return (point.clientX - box.left) / box.width
  }
  return pageFlipped()
    ? (box.bottom - point.clientY) / box.height
    : (point.clientY - box.top) / box.height
}

// Radix's dialogs and menus lock the page's scroll with react-remove-scroll, which judges a finger's drag in the
// screen's axes: on the turned page a drag along the page reads as sideways, and it cancels a drag the panel can't
// scroll that way, so nothing in the panel scrolled. Stopped inside the panel, the drag never reaches that lock
// (it listens on the document); the turned page is fixed, so nothing under the panel scrolls anyway
export const keepScrollWhenTurned = (event: {
  stopPropagation: () => void
}) => {
  if (pageTurned()) {
    event.stopPropagation()
  }
}

// An element's fractional width along the page (offsetWidth rounds)
export const pageWidth = (element: Element) => {
  const box = element.getBoundingClientRect()
  return pageTurned() ? box.height : box.width
}
