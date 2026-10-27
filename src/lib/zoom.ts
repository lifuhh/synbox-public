// Whether the page is pinch-zoomed in, on <html data-zoomed>. The root's scroll lock (globals.css) stops the
// document from rubber-banding, but it also stops scrolls from chaining to the visual viewport, so a zoomed page
// could not be panned (WCAG 1.4.4, 1.4.10). The lock holds at normal zoom only. Pinch changes the scale through
// visualViewport's resize event; panning (its scroll event) never does
const ZOOMED = 1.01

export const trackZoom = () => {
  const viewport = window.visualViewport
  if (viewport === null) {
    return
  }
  const update = () => {
    document.documentElement.toggleAttribute(
      'data-zoomed',
      viewport.scale > ZOOMED
    )
  }
  update()
  viewport.addEventListener('resize', update, { passive: true })
}
