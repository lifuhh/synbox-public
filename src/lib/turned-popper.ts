import { platform } from '@floating-ui/dom'
import type { Platform, Rect } from '@floating-ui/dom'

import { pagePoint, pageTurned } from '@/lib/page-turn'

// Radix places menus, popovers and tooltips with Floating UI, which reads boxes from the browser in the screen's
// axes, then moves the menu inside the body. On a page turned by Lock Landscape the body is rotated, so the menu
// was moved by screen numbers along the page's axes, and its collision checks pushed it against an upright
// screen: it opened a third of the page away from its button. While the page is turned, Floating UI gets the
// page's axes instead: the trigger's box turned into them, the page as the viewport, no scale. It reads this
// object on every placement, so the change also reaches Radix's own copy of it
const pageRect = (box: DOMRect): Rect => {
  const a = pagePoint({ clientX: box.left, clientY: box.top })
  const b = pagePoint({ clientX: box.right, clientY: box.bottom })
  return {
    height: Math.abs(a.y - b.y),
    width: Math.abs(a.x - b.x),
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
  }
}

const screen = { ...platform }

const turnedPlatform: Partial<Platform> = {
  convertOffsetParentRelativeRectToViewportRelativeRect(args) {
    return pageTurned()
      ? args.rect
      : screen.convertOffsetParentRelativeRectToViewportRelativeRect?.call(
          this,
          args
        )
  },
  getClippingRect(args) {
    return pageTurned()
      ? {
          height: document.body.clientHeight,
          width: document.body.clientWidth,
          x: 0,
          y: 0,
        }
      : screen.getClippingRect.call(this, args)
  },
  async getElementRects(args) {
    if (!pageTurned()) {
      return await screen.getElementRects.call(this, args)
    }
    const { width, height } = await screen.getDimensions.call(
      this,
      args.floating
    )
    return {
      floating: { height, width, x: 0, y: 0 },
      reference: pageRect(args.reference.getBoundingClientRect()),
    }
  },
  getScale(element) {
    return pageTurned()
      ? { x: 1, y: 1 }
      : (screen.getScale?.call(this, element) ?? { x: 1, y: 1 })
  },
}

Object.assign(platform, turnedPlatform)
