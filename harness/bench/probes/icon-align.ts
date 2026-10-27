// Icon beside text, on one centre line: in every visible control (button, link, tab, menu item, option, radio,
// switch) that holds an icon (svg) and a one-line label side by side, the icon's vertical centre against the
// label's ink centre. AGENTS.md › "Measure alignment" allows 1px.
//
// The ink centre is not the text box's centre: a font's line box reserves its ascender and descender, which are
// rarely even (Plus Jakarta Sans' ascent is taller than its descent), so a label centred by its box draws its
// letters off the box's middle. What reads as the label's middle is half its cap height above the baseline (half
// the x-height for a label in lower case only; for CJK, the middle of the label's own ink). Measured as:
// - the baseline: a zero-size inline-block at `vertical-align: baseline` placed right before the text, in the
//   text's own line (an empty inline-block's baseline is its bottom edge, so its box sits on the line's baseline).
//   When the text's parent is a flex or grid box, the text is its own anonymous item; it is wrapped in a span for
//   the measurement so the marker shares its line instead of becoming a second item. The DOM is put back before
//   the function returns, in the same task, so nothing is painted or seen by the app;
// - the cap height (x-height): canvas `measureText` in the text's computed font (`actualBoundingBoxAscent` of "H"
//   or "x"), which reads the same loaded font file the page draws with.
//
// A deliberately off-centre glyph that is optically right carries `data-optical="<why>"` on the svg (or a parent
// inside the control) and is left out. A page turned by Lock Landscape is measured along its own vertical axis.
// Runs in the page: everything it needs is inside the function.

/** One label and icon off their shared centre line by more than `limitPx` */
export interface IconOffset {
  label: string
  /** The icon's centre minus the label's ink centre, along the content's vertical axis: positive = icon lower */
  offsetPx: number
  rect: { x: number; y: number; w: number; h: number }
}

export const ICON_ALIGN_LIMIT_PX = 1

export const iconTextOffsets = (limitPx: number): IconOffset[] => {
  const CONTROL =
    'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="radio"], [role="switch"]'
  const turned = Object.hasOwn(
    document.documentElement.dataset,
    'landscapeLock'
  )
  // The content's vertical position of a point on screen: y, or x on a page turned a quarter
  const along = (r: DOMRect) =>
    turned ? r.left + r.width / 2 : r.top + r.height / 2
  const seen = (el: Element): boolean => {
    const r = el.getBoundingClientRect()
    if (
      r.width < 1 ||
      r.height < 1 ||
      r.bottom <= 0 ||
      r.right <= 0 ||
      r.top >= innerHeight ||
      r.left >= innerWidth
    ) {
      return false
    }
    if (getComputedStyle(el).visibility === 'hidden') {
      return false
    }
    let opacity = 1
    for (let p: Element | null = el; p; p = p.parentElement) {
      opacity *= Number(getComputedStyle(p).opacity)
    }
    return opacity > 0.5
  }
  const canvas = document.createElement('canvas').getContext('2d')
  if (canvas === null) {
    return []
  }
  // The label's ink centre above its baseline, in px
  const inkAbove = (el: Element, text: string): number => {
    const cs = getComputedStyle(el)
    canvas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    if (/[　-鿿＀-￯]/u.test(text)) {
      const m = canvas.measureText(text)
      return (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2
    }
    const glyph = /[\p{Lu}\p{N}]/u.test(text) ? 'H' : 'x'
    return canvas.measureText(glyph).actualBoundingBoxAscent / 2
  }
  // The baseline of a text node's line, on screen (content's vertical axis); the DOM is restored before it returns
  const baselineOf = (node: Text): number => {
    const parent = node.parentElement
    if (parent === null) {
      return Number.NaN
    }
    const display = getComputedStyle(parent).display
    const itemized = /flex|grid/u.test(display)
    const marker = document.createElement('span')
    marker.style.cssText =
      'display:inline-block;width:0;height:0;margin:0;padding:0;border:0;vertical-align:baseline'
    let wrap: HTMLSpanElement | null = null
    if (itemized) {
      wrap = document.createElement('span')
      parent.insertBefore(wrap, node)
      wrap.append(marker, node)
    } else {
      parent.insertBefore(marker, node)
    }
    const r = marker.getBoundingClientRect()
    const y = turned ? r.left : r.bottom
    if (wrap === null) {
      marker.remove()
    } else {
      wrap.before(node)
      wrap.remove()
    }
    return y
  }
  const found: IconOffset[] = []
  for (const control of document.querySelectorAll(CONTROL)) {
    if (!seen(control)) {
      continue
    }
    // Its own icons and text, not those of a control nested inside it
    const own = (n: Node) =>
      (n instanceof Element ? n : n.parentElement)?.closest(CONTROL) ===
      control
    const icons = [...control.querySelectorAll('svg')].filter(
      (svg) => own(svg) && seen(svg) && svg.closest('[data-optical]') === null
    )
    if (icons.length === 0) {
      continue
    }
    const texts: { node: Text; rect: DOMRect; text: string }[] = []
    const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim()
      const parent = n.parentElement
      if (
        text === '' ||
        parent === null ||
        !own(n) ||
        !seen(parent) ||
        parent.closest('svg') !== null
      ) {
        continue
      }
      const range = document.createRange()
      range.selectNodeContents(n)
      const lines = [...range.getClientRects()].filter(
        (r) => r.width > 1 && r.height > 1
      )
      // One line only: a wrapped label has no single centre line to meet
      if (lines.length === 1 && n instanceof Text) {
        texts.push({ node: n, rect: lines[0], text })
      }
    }
    // A label is one line: a control whose text runs on several lines (a song row's title over its artist, a card)
    // is a layout, not an icon and its label
    const spans = texts.map(({ rect }) =>
      turned ? [rect.left, rect.right] : [rect.top, rect.bottom]
    )
    const oneLine =
      texts.length > 0 &&
      Math.max(...spans.map(([a]) => a)) < Math.min(...spans.map(([, z]) => z))
    if (!oneLine) {
      continue
    }
    for (const svg of icons) {
      const ir = svg.getBoundingClientRect()
      // An icon, not artwork: lucide's sizes run 12-28px
      if (Math.max(ir.width, ir.height) > 32) {
        continue
      }
      // The label beside this icon: across its centre line, apart from it along the other axis, the nearest
      const centre = along(ir)
      const beside = texts
        .filter(({ rect }) =>
          turned
            ? rect.left < centre &&
              rect.right > centre &&
              (rect.bottom <= ir.top + 1 || rect.top >= ir.bottom - 1)
            : rect.top < centre &&
              rect.bottom > centre &&
              (rect.right <= ir.left + 1 || rect.left >= ir.right - 1)
        )
        .map((t) => {
          const r = t.rect
          const gap = turned
            ? Math.max(r.top - ir.bottom, ir.top - r.bottom)
            : Math.max(r.left - ir.right, ir.left - r.right)
          return { ...t, gap }
        })
        .filter((t) => t.gap <= 24)
        .toSorted((a, z) => a.gap - z.gap)[0]
      if (beside === undefined) {
        continue
      }
      const parent = beside.node.parentElement
      if (parent === null) {
        continue
      }
      const baseline = baselineOf(beside.node)
      // Which way the content's "down" points on screen: the text's box lies above its baseline
      const down = along(beside.rect) < baseline ? 1 : -1
      const ink = baseline - down * inkAbove(parent, beside.text)
      const offset = down * (along(ir) - ink)
      if (Number.isFinite(offset) && Math.abs(offset) > limitPx) {
        const r = control.getBoundingClientRect()
        found.push({
          label: (control.getAttribute('aria-label') ?? beside.text)
            .trim()
            .slice(0, 40),
          offsetPx: Math.round(offset * 10) / 10,
          rect: {
            h: Math.round(r.height),
            w: Math.round(r.width),
            x: Math.round(r.x),
            y: Math.round(r.y),
          },
        })
      }
    }
  }
  return found
}
