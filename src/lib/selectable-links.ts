import type { MouseEvent, PointerEvent } from 'react'

// Text inside a link selects like any other text: a drag over a song's or channel's name selects it (links don't
// start a link drag, globals.css), and the click that ends the drag doesn't follow the link. A plain click still
// does. Installed once for the whole app (app.tsx), so every link,
// present and future, behaves this way
const selectionIn = (element: Element) => {
  const selection = getSelection()
  if (
    selection === null ||
    selection.isCollapsed ||
    selection.toString().trim() === ''
  ) {
    return false
  }
  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (selection.getRangeAt(index).intersectsNode(element)) {
      return true
    }
  }
  return false
}

// What was selected when the press began: a click on text selected earlier (to copy it, say) still follows the
// link; only a selection this press made holds it back
let selectedAtPress = ''
document.addEventListener(
  'pointerdown',
  () => {
    selectedAtPress = getSelection()?.toString() ?? ''
  },
  { capture: true }
)

document.addEventListener(
  'click',
  (event) => {
    const link =
      event.target instanceof Element ? event.target.closest('a[href]') : null
    if (
      link !== null &&
      event.button === 0 &&
      selectionIn(link) &&
      getSelection()?.toString() !== selectedAtPress
    ) {
      event.preventDefault()
    }
  },
  { capture: true }
)

const wantsNewTab = (event: MouseEvent | PointerEvent) =>
  event.button === 1 || (event.button === 0 && (event.metaKey || event.ctrlKey))

// For a button that opens a menu standing in for a page (Saved, Account): Ctrl or Cmd-click, or a middle click,
// opens that page in a new tab, as a link would, instead of the menu. Spread on the button itself, so it runs
// before the menu's own trigger and stops it
export const newTabHandlers = (path: string) => ({
  onAuxClick: (event: MouseEvent) => {
    if (event.button === 1) {
      event.preventDefault()
      window.open(path, '_blank', 'noopener')
    }
  },
  onClick: (event: MouseEvent) => {
    if (wantsNewTab(event)) {
      event.preventDefault()
      window.open(path, '_blank', 'noopener')
    }
  },
  // A dropdown opens on press, before the click
  onPointerDown: (event: PointerEvent) => {
    if (wantsNewTab(event)) {
      event.preventDefault()
    }
  },
})
