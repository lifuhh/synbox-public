import { pageWidth } from './page-turn'

// Wraps a lyric into lines of even length: the narrowest width that still takes no more
// lines than a plain wrap. CSS text-wrap: balance does this in Chromium, but WebKit (every iPhone browser)
// mis-measures <ruby>: a line with furigana that fits on two lines came out as three, the last one a single
// character. Measured once per element, so give the element a key that changes with its text.
// The width is set, not capped: in a box that shrinks to its text (the translation's handle, w-fit) a cap left the
// line exactly as wide as its text, and WebKit broke such a line before its last word (saq0a2eG5y4 in Lock
// Landscape, 2026-10-26). For the same reason the plain wrap it compares with is taken at the whole room the box
// may grow to, not at the text's own width
const keepBalanced = (element: HTMLElement) => {
  let balanced = { height: 0, width: 0 }
  let page = 0
  const balance = () => {
    const { style } = element
    // As wide as the room allows: the page's width, capped by the box it is in
    page = pageWidth(document.body)
    style.inlineSize = `${page}px`
    style.maxInlineSize = '100%'
    // A line with furigana stands taller than one without in WebKit, so a new line is any growth past the
    // most furigana add
    const lineAdded =
      element.offsetHeight +
      // oxlint-disable-next-line unicorn/prefer-number-coercion -- the value ends in px, which Number() rejects
      Number.parseFloat(getComputedStyle(element).fontSize) * 0.75
    let narrow = 0
    // Fractional: offsetWidth rounds down, and a line exactly that wide would wrap
    let wide = pageWidth(element)
    while (wide - narrow > 1) {
      const middle = (narrow + wide) / 2
      style.inlineSize = `${middle}px`
      // Too narrow once a line is added, or once a word that can't break sticks out of the box: a one-word
      // line never gains a row, and squeezed to nothing it would start at the centre and run off to the right
      if (
        element.offsetHeight > lineAdded ||
        element.scrollWidth > element.clientWidth
      ) {
        narrow = middle
      } else {
        wide = middle
      }
    }
    style.inlineSize = `${wide}px`
    balanced = { height: element.offsetHeight, width: element.offsetWidth }
  }
  balance()
  // A new font or size changes the element's box, and a narrower room squeezes it (it is capped at 100%); the box
  // set here is no reason to run again
  const observer = new ResizeObserver(() => {
    if (
      element.offsetHeight !== balanced.height ||
      element.offsetWidth !== balanced.width
    ) {
      balance()
    }
  })
  observer.observe(element)
  // A wider room leaves the set box as it was, so only the page says there is more: the window, or Lock Landscape
  // turning the page by CSS, which resizes no window
  const widened = new ResizeObserver(() => {
    if (Math.abs(pageWidth(document.body) - page) > 1) {
      balance()
    }
  })
  widened.observe(document.body)
  return () => {
    observer.disconnect()
    widened.disconnect()
  }
}

// A ref callback. React calls it with null only when it returned no cleanup
export const balanceWrap = (element: HTMLElement | null) =>
  element ? keepBalanced(element) : undefined
