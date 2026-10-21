import { pageWidth } from './page-turn'

// Wraps a lyric into lines of even length: the narrowest width that still takes no more
// lines than a plain wrap. CSS text-wrap: balance does this in Chromium, but WebKit (every iPhone browser)
// mis-measures <ruby>: a line with furigana that fits on two lines came out as three, the last one a single
// character. Measured once per element, so give the element a key that changes with its text
const keepBalanced = (element: HTMLElement) => {
  let balanced = { height: 0, width: 0 }
  const balance = () => {
    const { style } = element
    style.maxInlineSize = ''
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
      style.maxInlineSize = `${middle}px`
      if (element.offsetHeight > lineAdded) {
        narrow = middle
      } else {
        wide = middle
      }
    }
    style.maxInlineSize = `${wide}px`
    balanced = { height: element.offsetHeight, width: element.offsetWidth }
  }
  balance()
  // A new font or size changes the element's box; the box set here is no reason to run again
  const observer = new ResizeObserver(() => {
    if (
      element.offsetHeight !== balanced.height ||
      element.offsetWidth !== balanced.width
    ) {
      balance()
    }
  })
  observer.observe(element)
  // A wider stage leaves the balanced box as it was, so only the window says there is more room
  window.addEventListener('resize', balance)
  return () => {
    observer.disconnect()
    window.removeEventListener('resize', balance)
  }
}

// A ref callback. React calls it with null only when it returned no cleanup
export const balanceWrap = (element: HTMLElement | null) =>
  element ? keepBalanced(element) : undefined
