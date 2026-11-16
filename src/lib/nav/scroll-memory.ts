// Where each page was scrolled to when it was left, so Back (and, in the installed app, a tab) returns to the same
// place instead of the top. A page scrolls its own box (data-scroll-top) or, on the wide watch page, the document;
// the box is unmounted with its page, so the place is kept here, per history entry and per tab
const MAX_PLACES = 200
const places = new Map<string, number>()

const scroller = () =>
  document.querySelector<HTMLElement>('[data-scroll-top]') ??
  document.scrollingElement

export const rememberScroll = (...keys: string[]) => {
  const top = scroller()?.scrollTop ?? 0
  for (const key of keys) {
    places.delete(key)
    places.set(key, top)
  }
  for (const oldest of places.keys()) {
    if (places.size <= MAX_PLACES) {
      break
    }
    places.delete(oldest)
  }
}

// How long a page gets to grow tall enough (its list loading) and is held at its place
const RESTORE_WINDOW_MS = 1000
const TAKEOVER_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown']

let restoring = 0

// Scrolls the page now showing to the place kept under `key`, at once (the pages' boxes glide by default, and a
// page that arrives already in place is the point). A page whose content arrives after it (a list still loading)
// is put there again each frame, until the viewer touches the page themselves or the window ends
export const restoreScroll = (key: string) => {
  restoring += 1
  const run = restoring
  const top = places.get(key) ?? 0
  if (top <= 0) {
    return
  }
  const deadline = performance.now() + RESTORE_WINDOW_MS
  const stop = () => {
    if (restoring === run) {
      restoring += 1
    }
  }
  const options = { capture: true, once: true, passive: true }
  for (const type of TAKEOVER_EVENTS) {
    window.addEventListener(type, stop, options)
  }
  const attempt = () => {
    if (restoring !== run) {
      return
    }
    // Held for the whole window, not only until first reached: a page swaps its placeholder box for the loaded
    // one, which starts at the top again
    const box = scroller()
    if (box !== null && Math.abs(box.scrollTop - top) > 1) {
      box.scrollTo({ behavior: 'instant', top })
    }
    if (performance.now() < deadline) {
      requestAnimationFrame(attempt)
    }
  }
  attempt()
}
