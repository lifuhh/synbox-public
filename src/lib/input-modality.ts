// Whether the last input was a key or a pointer, on <html data-input-modality>. A text field matches :focus-visible
// even when clicked, so its keyboard focus indicator (globals.css) shows only while the last input was a key: Tab,
// the arrows (a TV remote's D-pad) or Enter. Typing into the field doesn't count, or a click into it then a letter
// would light it up
const NAVIGATION_KEYS = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  'Escape',
])

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
