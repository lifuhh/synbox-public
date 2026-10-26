import { useCallback, useRef, useState } from 'react'

// How far a menu or popover from the player's controls opens from what can be seen of the button that opened it.
// A bare icon or text button (the bar's, most of the rail's) is drawn smaller than its press target, so a fixed
// offset from its box left 20px or more of empty stage between the glyph and the menu on a phone (owner,
// 2026-10-26: "way too much space gap between origin and the opened pane")
export const MENU_GAP = 6

type Side = 'top' | 'bottom' | 'left' | 'right'

// A background this opaque is the button's own visible surface (a disc, a pill); anything fainter is a hover tint
const SURFACE_ALPHA = 0.3

const alphaOf = (color: string) => {
  if (color === 'transparent') {
    return 0
  }
  const [, afterSlash] = color.split('/')
  if (afterSlash !== undefined) {
    return Number(/[\d.]+/u.exec(afterSlash)?.[0] ?? 1)
  }
  const parts = color.match(/[\d.]+/gu) ?? []
  return color.startsWith('rgba') ? Number(parts.at(-1)) : 1
}

// The box of what the button draws: its own box when it paints a surface, else its icons and text
const drawnBox = (button: HTMLElement): DOMRect => {
  const box = button.getBoundingClientRect()
  if (alphaOf(getComputedStyle(button).backgroundColor) >= SURFACE_ALPHA) {
    return box
  }
  const rects: DOMRect[] = [...button.querySelectorAll('svg')].map((svg) =>
    svg.getBoundingClientRect()
  )
  const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if ((node.textContent ?? '').trim() !== '') {
      const range = document.createRange()
      range.selectNodeContents(node)
      rects.push(range.getBoundingClientRect())
    }
  }
  // Over 1px: screen-reader-only text is a 1px box
  const drawn = rects.filter((rect) => rect.width > 1 && rect.height > 1)
  if (drawn.length === 0) {
    return box
  }
  const left = Math.min(...drawn.map((rect) => rect.left))
  const top = Math.min(...drawn.map((rect) => rect.top))
  const right = Math.max(...drawn.map((rect) => rect.right))
  const bottom = Math.max(...drawn.map((rect) => rect.bottom))
  return new DOMRect(left, top, right - left, bottom - top)
}

// The empty part of the button between its edge on `side` and what it draws
const insetOn = (button: HTMLElement, side: Side) => {
  const box = button.getBoundingClientRect()
  const drawn = drawnBox(button)
  const insets: Record<Side, number> = {
    bottom: box.bottom - drawn.bottom,
    left: drawn.left - box.left,
    right: box.right - drawn.right,
    top: drawn.top - box.top,
  }
  return insets[side]
}

// The sideOffset that puts a menu on `side` of `trigger` MENU_GAP from its drawn part. A flipped side (no room) keeps
// the measure of the side asked for, the same on a symmetric button
export const menuOffset = (trigger: HTMLElement, side: Side) =>
  Math.round(MENU_GAP - insetOn(trigger, side))

// menuOffset, measured as the menu opens: give the trigger `triggerRef` and call `measure` when it opens
export const useMenuOffset = <T extends HTMLElement>(side: Side) => {
  const triggerRef = useRef<T>(null)
  const [offset, setOffset] = useState(MENU_GAP)
  const measure = useCallback(() => {
    const trigger = triggerRef.current
    if (trigger !== null) {
      setOffset(menuOffset(trigger, side))
    }
  }, [side])
  return { measure, offset, triggerRef }
}
