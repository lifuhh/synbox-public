// Whether someone is driving the page with the keyboard, on <html data-input-modality>. The focus ring (globals.css)
// draws only while it reads 'keyboard', which only Tab sets: a mouse or touch user never sees it, not on load, not
// after a phone keyboard's Go (an Enter), not after Escape closes a dialog. Any pointer press turns it off again
const NAVIGATION_KEYS = new Set(['Tab'])

export const trackInputModality = () => {
  const root = document.documentElement
  window.addEventListener(
    'keydown',
    (event) => {
      if (NAVIGATION_KEYS.has(event.key)) {
        root.dataset.inputModality = 'keyboard'
      }
    },
    { capture: true }
  )
  window.addEventListener(
    'pointerdown',
    () => {
      root.dataset.inputModality = 'pointer'
    },
    { capture: true }
  )
}
