import { reloadPage } from '@/lib/pwa'
import { scrollMotion } from '@/lib/reduced-motion'

// Within this many pixels of the top counts as at the top (iOS reports a pull past the top as negative)
const TOP_SLACK_PX = 2

// What a tap on the top bar's empty space means, as on iOS: a page scrolled down goes back to its top; one
// already there reloads, on the waiting version when one is downloaded
export const topTap = () => {
  // The page's own box (data-scroll-top) and the document, which scrolls on the wide watch page
  const scrolled = [
    document.querySelector<HTMLElement>('[data-scroll-top]'),
    document.scrollingElement,
  ].filter(
    (box): box is Element => box !== null && box.scrollTop > TOP_SLACK_PX
  )
  if (scrolled.length === 0) {
    return reloadPage() ? 'reload' : 'none'
  }
  for (const box of scrolled) {
    box.scrollTo({ behavior: scrollMotion(), top: 0 })
  }
  return 'scroll'
}

// Presses on the bar's own controls are theirs: a button, link, field or anything in a menu that opened from it
const INTERACTIVE =
  'a, button, input, textarea, select, label, [role="button"], [role="dialog"], [role="menu"], [role="listbox"], [tabindex]:not([tabindex="-1"])'

// A press on the bar and on none of its controls
export const onEmptyBar = (bar: Element, target: EventTarget | null) => {
  if (!(target instanceof Element) || !bar.contains(target)) {
    return false
  }
  const control = target.closest(INTERACTIVE)
  return control === null || !bar.contains(control)
}
