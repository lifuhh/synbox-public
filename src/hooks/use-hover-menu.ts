import { useEffect, useId, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'

// A menu opens once the pointer has rested on its button this long, plus the panel's 200 ms fade. Long enough that
// a quick pass over a button opens nothing; a slow drift over one does. NN/g's 300-500 ms felt far too slow
export const HOVER_OPEN_MS = 100
// and closes once the pointer has been off both the button and the menu this long (NN/g: 0.5 s), so a pointer
// that slips past the menu's edge or crosses the gap to it doesn't lose it
export const HOVER_CLOSE_MS = 500

interface Point {
  x: number
  y: number
}

// The one menu open from a hover, shared by every button, so only one is ever open and the next can take over
interface Shown {
  id: string
  // `instant`: another menu is taking over, so this one goes without its exit animation
  close: (instant: boolean) => void
  panel: () => Element | null
  // Where the pointer left the button, while it is on its way to the menu
  leftAt: Point | null
}
let shown: Shown | null = null

const mouse = (event: PointerEvent) => event.pointerType === 'mouse'

// How long until every menu that is closing has finished its exit animation (a fade, the bell's shrink), so the
// next menu opens after it and two panels are never on screen. An exit can't be cut short: Radix's Presence would
// wait for an `animationend` that never comes
const exitLeft = () => {
  let left = 0
  for (const panel of document.querySelectorAll(
    '[data-radix-popper-content-wrapper] > [data-state="closed"]'
  )) {
    for (const animation of panel.getAnimations({ subtree: true })) {
      const end = animation.effect?.getComputedTiming().endTime
      const now = animation.currentTime
      if (typeof end === 'number' && typeof now === 'number') {
        left = Math.max(left, end - now)
      }
    }
  }
  return left
}

const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

// Whether the pointer is in the triangle from where it left the button to the near edge of the open menu: on its
// way into the menu, crossing whatever lies between (Amazon's menu-aim). A button under that path doesn't take over
const aiming = (menu: Shown, at: Point) => {
  const box = menu.panel()?.getBoundingClientRect()
  if (menu.leftAt === null || box === undefined) {
    return false
  }
  const from = menu.leftAt
  const y = from.y < box.top ? box.top : box.bottom
  const corners: [Point, Point] = [
    { x: box.left, y },
    { x: box.right, y },
  ]
  const sides = [
    cross(from, corners[0], at),
    cross(corners[0], corners[1], at),
    cross(corners[1], from, at),
  ]
  // Strictly inside: the point where it left the button is on the triangle's corner, and a neighbouring button
  // entered at that same point is not on the way to the menu
  return sides.every((side) => side > 0) || sides.every((side) => side < 0)
}

const typingIn = (panel: Element | null) => {
  const active = document.activeElement
  return (
    panel !== null &&
    active !== null &&
    panel.contains(active) &&
    active.matches('input, textarea, [contenteditable="true"]')
  )
}

// With a mouse, a top-bar or rail menu opens while the pointer rests on its button and closes once the pointer has
// left both button and menu; a press opens it the same way and never closes or pins it. A menu a mouse opened
// is non-modal and leaves focus where it was. Touch and the keyboard open and close it as before: Radix's own
// press and keys, modal where the menu is. Spread `trigger` on the button and `content` on the Radix content
export const useHoverMenu = (
  open: boolean,
  onOpenChange: (open: boolean) => void
) => {
  const id = useId()
  const [mouseOpened, setMouseOpened] = useState(false)
  // Switched to or from a sibling menu: it appears (true) or goes (false) at once, as a menu bar's menus do, so
  // two panels never animate over each other. Only that one transition: a later open or close animates
  const [instantTo, setInstantTo] = useState<boolean | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setMouseOpened(false)
    }
  }
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const trigger = useRef<HTMLElement | null>(null)
  const pressedByMouse = useRef(false)
  // Read as the menu hands focus back on closing, after `mouseOpened` has reset
  const closingFromMouse = useRef(false)
  const change = useRef(onOpenChange)
  useEffect(() => {
    change.current = onOpenChange
  })
  const self = useRef<Shown>({
    close: (closeInstantly) => {
      setInstantTo(closeInstantly ? false : null)
      change.current(false)
    },
    id,
    leftAt: null,
    panel: () => {
      const controls = trigger.current?.getAttribute('aria-controls')
      return controls === null || controls === undefined
        ? null
        : document.querySelector(`#${CSS.escape(controls)}`)
    },
  })

  useEffect(() => {
    if (open && !mouseOpened) {
      closingFromMouse.current = false
    }
  }, [open, mouseOpened])
  useEffect(() => {
    if (!open && shown?.id === id) {
      shown = null
    }
  }, [open, id])
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      if (shown?.id === id) {
        shown = null
      }
    },
    [id]
  )

  const openNow = (switching: boolean) => {
    clearTimeout(timer.current)
    if (shown !== null && shown.id !== id) {
      shown.close(true)
    }
    setInstantTo(switching ? true : null)
    shown = self.current
    self.current.leftAt = null
    closingFromMouse.current = true
    setMouseOpened(true)
    onOpenChange(true)
  }
  const closeLater = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (!typingIn(self.current.panel())) {
        setInstantTo(null)
        onOpenChange(false)
      }
    }, HOVER_CLOSE_MS)
  }

  const triggerProps = {
    // Radix's Popover toggles on the click a mouse press already handled
    onClick: (event: MouseEvent) => {
      if (pressedByMouse.current) {
        pressedByMouse.current = false
        event.preventDefault()
      }
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      pressedByMouse.current = mouse(event) && event.button === 0
      if (pressedByMouse.current) {
        // Skips Radix's DropdownMenu toggle
        event.preventDefault()
        trigger.current = event.currentTarget
        if (!open) {
          openNow(false)
        }
        clearTimeout(timer.current)
      }
    },
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (!mouse(event)) {
        return
      }
      trigger.current = event.currentTarget
      clearTimeout(timer.current)
      if (open) {
        self.current.leftAt = null
        return
      }
      const at = { x: event.clientX, y: event.clientY }
      // Moving from one open menu's button to the next swaps them at once, as a menu bar does
      if (shown !== null && shown.id !== id && !aiming(shown, at)) {
        openNow(true)
        return
      }
      const openAfterExits = () => {
        const left = exitLeft()
        if (left > 0) {
          timer.current = setTimeout(openAfterExits, left)
          return
        }
        openNow(false)
      }
      timer.current = setTimeout(openAfterExits, HOVER_OPEN_MS)
    },
    onPointerLeave: (event: PointerEvent) => {
      if (!mouse(event)) {
        return
      }
      clearTimeout(timer.current)
      if (open) {
        self.current.leftAt = { x: event.clientX, y: event.clientY }
        closeLater()
      }
    },
  }

  return {
    // Opened by a mouse: not modal, and focus stays where it was
    byMouse: open && mouseOpened,
    content: {
      'data-menu-instant': instantTo === open || undefined,
      onCloseAutoFocus: (event: Event) => {
        if (closingFromMouse.current) {
          event.preventDefault()
        }
      },
      onOpenAutoFocus: (event: Event) => {
        if (mouseOpened) {
          event.preventDefault()
        }
      },
      // A press on the button lands outside the menu, which would close it
      onPointerDownOutside: (event: Event) => {
        if (
          event.target instanceof Node &&
          trigger.current?.contains(event.target) === true
        ) {
          event.preventDefault()
        }
      },
      onPointerEnter: (event: PointerEvent) => {
        if (mouse(event)) {
          clearTimeout(timer.current)
          self.current.leftAt = null
        }
      },
      onPointerLeave: (event: PointerEvent) => {
        if (mouse(event) && open) {
          closeLater()
        }
      },
    },
    trigger: triggerProps,
    // The trigger's handlers after the button's own (a Ctrl-click that opens a new tab), which can prevent them
    triggerAfter: <
      Own extends {
        onClick?: (event: MouseEvent) => void
        onPointerDown?: (event: PointerEvent) => void
      },
    >(
      own: Own
    ) => ({
      ...own,
      ...triggerProps,
      onClick: (event: MouseEvent) => {
        own.onClick?.(event)
        if (!event.defaultPrevented) {
          triggerProps.onClick(event)
        }
      },
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        own.onPointerDown?.(event)
        if (!event.defaultPrevented) {
          triggerProps.onPointerDown(event)
        }
      },
    }),
  }
}
