// Runs inside the page before any app script (an init script). It seeds Math.random, timestamps when watched
// elements first become visible, records paint metrics, long tasks, player phases and lyric line changes, and
// offers a frame recorder, a layout settle and a layout audit. Every time is performance.now(), ms after navigation start.

/* oxlint-disable unicorn/consistent-function-scoping -- recorder() is serialised with toString() and injected into the page, so every helper it uses must be declared inside it */

import type { Rect } from '../types'

/** Named elements to timestamp. `img: true` waits until an image inside has decoded, not just the box */
export const WATCH: Record<string, { selector: string; img?: boolean }> = {
  // The app marks what the probes wait for with data-bench, so a redesign keeps them working unless it removes
  // the element; a mark that never fires names the missing hook
  'carousel-slide': {
    img: true,
    selector: '[data-bench=carousel] [data-bench=carousel-slide]',
  },
  // Every chart row in, both playlist pages fetched (deleted or private videos drop out, so not always 100)
  'charts-done': {
    selector: '[data-bench=charts][aria-busy=false] [data-bench=charts-row]',
  },
  'charts-row': { selector: '[data-bench=charts-row]' },
  'gallery-tile': { img: true, selector: '[data-bench=gallery-tile]' },
  'hero-input': { selector: '[data-bench=hero-input]' },
  // Lyrics on screen: the stage's current lines, or the lyrics panel's and the reader's full list
  'lyrics-line': {
    selector: '[data-bench=lyrics-line], [data-bench=lyrics-text]',
  },
  // The route's own content: the root layout's outlet has rendered something. Routes are lazy behind a Suspense
  // with no fallback, so until the page's chunk arrives (and React reveals it) the page is empty and looks settled
  page: { selector: '[data-status-scrim] ~ section > *' },
  // The YouTube player lives in one persistent layer at the top of the body, outside the stage
  'player-iframe': {
    selector: '[data-stage-video] iframe, [data-player-stage] iframe',
  },
  'search-result': { img: true, selector: '[data-bench=search-result]' },
  topbar: { selector: '[data-topbar]' },
}

export interface FrameStats {
  frames: number
  fps: number
  p95Ms: number
  maxMs: number
  /** Share of frames that took over 25ms, i.e. missed at least one 60Hz vsync */
  droppedRatio: number
  longTaskMs: number
}

export interface AuditTarget {
  label: string
  rect: Rect
}

export interface Audit {
  viewport: { w: number; h: number }
  overflowX: number
  targets: number
  small: AuditTarget[]
  occluded: { label: string; by: string }[]
  offscreen: AuditTarget[]
  unsafe: AuditTarget[]
  /** Anything painted by a fixed or sticky layer inside a safe-area inset, outside the designed backdrops */
  insetSurfaces: AuditTarget[]
  /** How far the page itself is panned sideways (scrollX, the visual viewport's offset), and why */
  pan: { px: number; detail: string }
  /** Text fields, on a phone, set under 16px: iOS zooms the page into them on focus */
  zoomInputs: AuditTarget[]
  /** Placeholders and single-line labels wider than their box, with no title or aria-label holding the full text */
  clipped: AuditTarget[]
  /** Controls and dialogs a screen reader announces with no name (WCAG 4.1.2) */
  unnamed: AuditTarget[]
  /** Boxes that scroll but hold nothing focusable and take no focus themselves: a keyboard can't scroll them (2.1.1) */
  unscrollable: AuditTarget[]
}

/**
 * What a phone's safe-area insets may show (insetSurfaces): these designed backdrops, by selector, and any
 * background-only box running the screen's full width or height (a bar's background padding the status bar, a
 * full-screen sheet). Their own box is allowed; what they hold is still checked. Anything else a fixed or sticky
 * layer paints inside an inset is a finding
 */
export const INSET_BACKDROPS: Record<string, string> = {
  '.status-scrim':
    "the reader's strip behind the status bar (globals.css › status-scrim)",
  '[data-status-scrim]':
    "the root layout's top scrim: the page's own glow behind the status bar and the bar (globals.css › top-scrim)",
}

interface Insets {
  top: number
  bottom: number
  left: number
  right: number
}

declare global {
  interface Window {
    __bench: {
      marks: Record<string, number>
      phases: { phase: string; t: number }[]
      lines: number[]
      longTasks: { start: number; dur: number }[]
      lcp: number
      cls: number
      fcp: number
      frames: { start: () => void; stop: () => FrameStats }
      audit: (safe: Insets) => Audit
      settle: (limitMs: number) => Promise<string | null>
      /** Remembers the page at rest, before an opened state's steps: what they open may cover what was there */
      rest: () => void
    }
  }
}

const recorder = (watch: typeof WATCH, backdrops: typeof INSET_BACKDROPS) => {
  // Seeded PRNG (mulberry32): the gallery's shuffle and anything else random repeats run to run
  let seed = 0x5e_ed
  /* oxlint-disable eslint/no-bitwise -- mulberry32 is defined by its bit operations */
  Math.random = () => {
    seed = Math.trunc(seed + 0x6d_2b_79_f5)
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
  /* oxlint-enable eslint/no-bitwise */

  const longTasks: { start: number; dur: number }[] = []
  const bench: Window['__bench'] = {
    audit: () => {
      throw new Error('replaced below')
    },
    cls: 0,
    fcp: 0,
    frames: {
      start: () => {
        // replaced below
      },
      stop: () => {
        throw new Error('replaced below')
      },
    },
    lcp: 0,
    lines: [],
    longTasks,
    marks: {},
    phases: [],
    rest: () => {
      // replaced below
    },
    settle: async () => {
      await Promise.reject(new Error('replaced below'))
      return null
    },
  }
  window.__bench = bench

  const observe = (type: string, fn: (e: PerformanceEntry) => void) => {
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          fn(e)
        }
      }).observe({ buffered: true, type })
    } catch {
      // WebKit lacks some entry types (longtask, largest-contentful-paint)
    }
  }
  observe('paint', (e) => {
    if (e.name === 'first-contentful-paint') {
      bench.fcp = e.startTime
    }
  })
  observe('largest-contentful-paint', (e) => {
    bench.lcp = e.startTime
  })
  let session = 0
  let sessionStart = 0
  let last = 0
  // LayoutShift is not in TypeScript's DOM types
  const isShift = (
    e: PerformanceEntry
  ): e is PerformanceEntry & { value: number; hadRecentInput: boolean } =>
    'value' in e && 'hadRecentInput' in e
  observe('layout-shift', (e) => {
    if (!isShift(e) || e.hadRecentInput) {
      return
    }
    if (e.startTime - last > 1000 || e.startTime - sessionStart > 5000) {
      session = 0
      sessionStart = e.startTime
    }
    session += e.value
    last = e.startTime
    bench.cls = Math.max(bench.cls, session)
  })
  observe('longtask', (e) => {
    longTasks.push({ dur: e.duration, start: e.startTime })
  })
  // When the user (the probe) last pressed or typed, so a probe can time input → response inside the page
  for (const type of ['pointerdown', 'keydown']) {
    document.addEventListener(
      type,
      (e) => {
        bench.marks.input = e.timeStamp
      },
      true
    )
  }

  const visible = (el: Element, img: boolean) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) {
      return false
    }
    if (!img) {
      return true
    }
    const i = el.querySelector('img')
    return i !== null && i.complete && i.naturalWidth > 0
  }
  let lastPhase = ''
  let lastLine = ''
  const tick = () => {
    const now = performance.now()
    for (const [name, w] of Object.entries(watch)) {
      if (bench.marks[name] === undefined) {
        // Any match counts: a looping carousel puts lazy, never-loaded clones first in the DOM
        const shown = [...document.querySelectorAll(w.selector)].some((el) =>
          visible(el, Boolean(w.img))
        )
        if (shown) {
          bench.marks[name] = now
        }
      }
    }
    const phase =
      document.querySelector<HTMLElement>('[data-player-stage]')?.dataset
        .phase ?? ''
    if (phase && phase !== lastPhase) {
      bench.phases.push({ phase, t: now })
      bench.marks[`phase-${phase}`] ??= now
      lastPhase = phase
    }
    const line =
      document.querySelector('[data-bench=lyrics-line]')?.textContent ?? ''
    if (line && line !== lastLine) {
      bench.lines.push(now)
      lastLine = line
    }
  }
  // Polled every frame and on every mutation: rAF alone stalls in background tabs, mutations alone miss image loads
  const loop = () => {
    tick()
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  new MutationObserver(tick).observe(document, {
    attributes: true,
    childList: true,
    subtree: true,
  })

  let recording: number[] | null = null
  let longFrom = 0
  const frameLoop = (t: number) => {
    if (recording) {
      recording.push(t)
      requestAnimationFrame(frameLoop)
    }
  }
  bench.frames = {
    start: () => {
      recording = []
      longFrom = longTasks.length
      requestAnimationFrame(frameLoop)
    },
    stop: () => {
      const ts = recording ?? []
      recording = null
      const gaps = ts.slice(1).map((t, i) => t - ts[i])
      const sorted = gaps.toSorted((a, b) => a - b)
      const span = ts.length > 1 ? (ts.at(-1) ?? ts[0]) - ts[0] : 0
      return {
        droppedRatio: gaps.length
          ? gaps.filter((g) => g > 25).length / gaps.length
          : 0,
        fps: span ? (gaps.length * 1000) / span : 0,
        frames: gaps.length,
        longTaskMs: longTasks
          .slice(longFrom)
          .reduce((s, l) => s + Math.max(0, l.dur - 50), 0),
        maxMs: sorted.at(-1) ?? 0,
        p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      }
    },
  }

  const TARGETS =
    'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=slider],[role=tab],[tabindex]:not([tabindex="-1"])'

  /**
   * Resolves once the layout has come to rest: fonts loaded, no finite animation or transition running, and every
   * press target's box and the page's scroll size unchanged over two frames. Null when settled; otherwise why not,
   * after `limitMs` (the audit then runs on what is there and says so).
   */
  bench.settle = async (limitMs) => {
    const key = () => {
      const parts: number[] = [
        document.documentElement.scrollWidth,
        document.documentElement.scrollHeight,
      ]
      for (const el of document.querySelectorAll(TARGETS)) {
        const r = el.getBoundingClientRect()
        parts.push(
          Math.round(r.x),
          Math.round(r.y),
          Math.round(r.width),
          Math.round(r.height)
        )
      }
      return parts.join(',')
    }
    const animating = () =>
      document.getAnimations().some((a) => {
        const end = a.effect?.getComputedTiming().endTime
        return (
          a.playState === 'running' &&
          typeof end === 'number' &&
          Number.isFinite(end)
        )
      })
    // One frame, or 100ms when WebKit holds frames back (a page it treats as hidden): the deadline must come
    const frame = async () => {
      // oxlint-disable-next-line promise/avoid-new -- one animation frame, as a promise
      await new Promise((resolve) => {
        requestAnimationFrame(resolve)
        setTimeout(resolve, 100)
      })
    }
    const deadline = performance.now() + limitMs
    await Promise.race([
      document.fonts.ready,
      // oxlint-disable-next-line promise/avoid-new -- the font wait shares the deadline
      new Promise((resolve) => {
        setTimeout(resolve, limitMs)
      }),
    ])
    let previous = ''
    let still = 0
    while (performance.now() < deadline) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one frame at a time is the point
      await frame()
      const now = key()
      still = now === previous && !animating() ? still + 1 : 0
      previous = now
      if (still >= 2) {
        return null
      }
    }
    return animating()
      ? `still animating after ${limitMs}ms`
      : `layout still moving after ${limitMs}ms`
  }

  const rectOf = (el: Element): Rect => {
    const r = el.getBoundingClientRect()
    return {
      h: Math.round(r.height),
      w: Math.round(r.width),
      x: Math.round(r.x),
      y: Math.round(r.y),
    }
  }
  const labelOf = (el: Element) => {
    const name =
      el.getAttribute('aria-label') ??
      el.getAttribute('title') ??
      el.getAttribute('placeholder') ??
      (el.textContent ?? '').trim().slice(0, 40)
    return `${el.tagName.toLowerCase()}${name ? ` "${name}"` : ''}`
  }
  /** The part of an element left visible by every clipping ancestor (scroll boxes, overflow: hidden) */
  const clipped = (el: Element): DOMRect | null => {
    const r = el.getBoundingClientRect()
    let { left, top, right, bottom } = r
    for (
      let p = el.parentElement;
      p && p !== document.documentElement;
      p = p.parentElement
    ) {
      const s = getComputedStyle(p)
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const c = p.getBoundingClientRect()
        if (s.overflowX !== 'visible') {
          left = Math.max(left, c.left)
          right = Math.min(right, c.right)
        }
        if (s.overflowY !== 'visible') {
          top = Math.max(top, c.top)
          bottom = Math.min(bottom, c.bottom)
        }
      }
      if (s.position === 'fixed') {
        break
      }
    }
    return right - left < 1 || bottom - top < 1
      ? null
      : new DOMRect(left, top, right - left, bottom - top)
  }

  // What a person sees of an element: laid out, on screen, not hidden, and not faded out with any ancestor (the
  // player's floating UI and the top bar's buttons hide by fading their wrappers)
  const seen = (el: Element) => {
    const r = el.getBoundingClientRect()
    if (
      r.width < 2 ||
      r.height < 2 ||
      r.bottom <= 0 ||
      r.right <= 0 ||
      r.top >= innerHeight ||
      r.left >= innerWidth ||
      getComputedStyle(el).visibility === 'hidden'
    ) {
      return false
    }
    let opacity = 1
    for (let p: Element | null = el; p; p = p.parentElement) {
      opacity *= Number(getComputedStyle(p).opacity)
    }
    return opacity > 0.05
  }

  /** A CSS length in px ('14px' → 14; 'normal' → 0) */
  const px = (value: string) => Number(value.replace(/px$/u, '')) || 0

  const rectFrom = (r: DOMRect): Rect => ({
    h: Math.round(r.height),
    w: Math.round(r.width),
    x: Math.round(r.x),
    y: Math.round(r.y),
  })

  /** The nearest ancestor that says where an element is: a data-* hook or a role */
  const hookOf = (e: Element): string | null => {
    const data = [...e.attributes].find(
      (a) => a.name.startsWith('data-') && !a.name.startsWith('data-state')
    )
    if (data) {
      const value =
        data.value !== '' && data.value.length < 24 ? `=${data.value}` : ''
      return `${e.tagName.toLowerCase()}[${data.name}${value}]`
    }
    const role = e.getAttribute('role')
    return role === null ? null : `${e.tagName.toLowerCase()}[role=${role}]`
  }

  const ownText = (el: Element) =>
    [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? '')
      .join('')
      .trim()

  /**
   * An element as `tag.first.classes "its own name or text"`, plus the nearest ancestor that says where it is:
   * enough to find it in the code
   */
  const describe = (el: Element) => {
    const name =
      el.getAttribute('aria-label') ??
      el.getAttribute('title') ??
      el.getAttribute('placeholder') ??
      ownText(el).slice(0, 40)
    const classes = [...el.classList].slice(0, 4).join('.')
    const self = `${hookOf(el) ?? el.tagName.toLowerCase()}${classes === '' ? '' : `.${classes}`}${name === '' ? '' : ` "${name}"`}`
    for (
      let p = el.parentElement;
      p && p !== document.body;
      p = p.parentElement
    ) {
      const h = hookOf(p)
      if (h !== null) {
        return `${self} in ${h}`
      }
    }
    return self
  }

  const alpha = (color: string) => {
    if (color === 'transparent' || color === '') {
      return 0
    }
    const slash = /\/\s*(?<a>[\d.]+)(?<pct>%?)\s*\)$/u.exec(color)
    if (slash?.groups) {
      return Number(slash.groups.a) / (slash.groups.pct === '' ? 1 : 100)
    }
    const rgba = /^rgba\([^,]+,[^,]+,[^,]+,\s*(?<a>[\d.]+)\s*\)$/u.exec(color)
    return rgba?.groups ? Number(rgba.groups.a) : 1
  }

  const REPLACED = new Set([
    'IMG',
    'svg',
    'VIDEO',
    'CANVAS',
    'IFRAME',
    'INPUT',
    'TEXTAREA',
    'SELECT',
  ])

  /** Paints a box of its own: a background, border, shadow or backdrop filter, or replaced content (an image, a field) */
  const paintsBox = (el: Element) => {
    const s = getComputedStyle(el)
    return (
      REPLACED.has(el.tagName) ||
      alpha(s.backgroundColor) > 0 ||
      s.backgroundImage !== 'none' ||
      s.boxShadow !== 'none' ||
      (s.backdropFilter !== '' && s.backdropFilter !== 'none') ||
      ['top', 'right', 'bottom', 'left'].some(
        (side) =>
          px(s.getPropertyValue(`border-${side}-width`)) > 0 &&
          alpha(s.getPropertyValue(`border-${side}-color`)) > 0
      )
    )
  }

  /** The box of an element's own text nodes, inside what clips it */
  const textBox = (el: Element): DOMRect | null => {
    const range = document.createRange()
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const node of el.childNodes) {
      if (
        node.nodeType === Node.TEXT_NODE &&
        (node.textContent ?? '').trim() !== ''
      ) {
        range.selectNodeContents(node)
        const r = range.getBoundingClientRect()
        left = Math.min(left, r.left)
        top = Math.min(top, r.top)
        right = Math.max(right, r.right)
        bottom = Math.max(bottom, r.bottom)
      }
    }
    const c = clipped(el)
    if (c === null || right <= left) {
      return null
    }
    const l = Math.max(left, c.left)
    const t = Math.max(top, c.top)
    const w = Math.min(right, c.right) - l
    const h = Math.min(bottom, c.bottom) - t
    return w < 1 || h < 1 ? null : new DOMRect(l, t, w, h)
  }

  /**
   * The box an element paints into, or null when it paints nothing of its own (an empty wrapper) or only a
   * full-bleed background (a bar's background padding an inset, a full-screen sheet: backdrops, as the scrims)
   */
  const paintBox = (el: Element): DOMRect | null => {
    if (!paintsBox(el)) {
      return textBox(el)
    }
    const box = clipped(el)
    const bleeds =
      box !== null &&
      !REPLACED.has(el.tagName) &&
      ownText(el) === '' &&
      (box.width >= innerWidth - 1 || box.height >= innerHeight - 1)
    return bleeds ? null : box
  }

  const scrollsInside = (el: Element) => {
    const s = getComputedStyle(el)
    return (
      (/auto|scroll/u.test(s.overflowY) &&
        el.scrollHeight > el.clientHeight + 1) ||
      (/auto|scroll/u.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1)
    )
  }

  /**
   * Safe-area intrusion by any surface, not only a press target's centre: everything a fixed or sticky layer paints
   * must clear the status bar, home indicator and side notches by more than 1px, except the designed backdrops
   * (INSET_BACKDROPS and full-bleed backgrounds). An element found counts once, its painted descendants with it.
   * What scrolls inside a layer (a list under its bars) passes under the insets on its way, as content scrolled
   * under the top bar does; only the layer's own chrome counts
   */
  const insetSurfacesOf = (safe: Insets): AuditTarget[] => {
    const vw = innerWidth
    const vh = innerHeight
    const intrudes = (r: DOMRect) =>
      (safe.top > 0 && r.top < safe.top - 1 && r.bottom > 0) ||
      (safe.bottom > 0 && r.bottom > vh - safe.bottom + 1 && r.top < vh) ||
      (safe.left > 0 && r.left < safe.left - 1 && r.right > 0) ||
      (safe.right > 0 && r.right > vw - safe.right + 1 && r.left < vw)
    const backdrop = Object.keys(backdrops).join(',')
    const found: AuditTarget[] = []
    const walk = (el: Element) => {
      if (!el.matches(backdrop) && seen(el)) {
        const box = paintBox(el)
        if (box && intrudes(box)) {
          found.push({ label: describe(el), rect: rectFrom(box) })
          return
        }
      }
      // An svg's shapes paint as the svg
      if (el.tagName !== 'svg' && !scrollsInside(el)) {
        for (const child of el.children) {
          walk(child)
        }
      }
    }
    const layers = [...document.body.querySelectorAll('*')].filter((el) =>
      ['fixed', 'sticky'].includes(getComputedStyle(el).position)
    )
    // A layer inside another is walked with it
    for (const layer of layers.filter(
      (l) => !layers.some((o) => o !== l && o.contains(l))
    )) {
      walk(layer)
    }
    return found
  }

  /**
   * The page panned sideways: what iOS does when a focused field (or anything) sits past the layout viewport's
   * side. The lab reports the scroll offsets; the real keyboard and iOS's zoom into a small field are not
   * emulated (zoomInputs predicts the zoom)
   */
  const panOf = () => {
    const pans: Record<string, number> = {
      'body.scrollLeft': document.body.scrollLeft,
      'documentElement.scrollLeft': document.documentElement.scrollLeft,
      scrollX: window.scrollX,
      'visualViewport.offsetLeft': window.visualViewport?.offsetLeft ?? 0,
      'visualViewport.pageLeft': window.visualViewport?.pageLeft ?? 0,
    }
    return {
      detail: Object.entries(pans)
        .filter(([, v]) => Math.round(v) !== 0)
        .map(([k, v]) => `${k} ${Math.round(v)}`)
        .join(', '),
      px: Math.round(Math.max(0, ...Object.values(pans))),
    }
  }

  const TEXT_TYPES = new Set([
    '',
    'text',
    'search',
    'email',
    'url',
    'tel',
    'password',
    'number',
  ])
  const textFields = () =>
    [
      ...document.querySelectorAll(
        'input, textarea, select, [contenteditable=""], [contenteditable=true]'
      ),
    ].filter(
      (el) =>
        !(el instanceof HTMLInputElement) ||
        TEXT_TYPES.has((el.getAttribute('type') ?? '').toLowerCase())
    )

  /**
   * Text fields under 16px, on a phone: iOS zooms the page into one when it takes focus, and the page then pans
   * sideways while the keyboard is up. Every field on screen counts, focused or not: any of them is a tap away
   */
  const zoomInputsOf = (): AuditTarget[] =>
    textFields()
      .filter(
        (el) =>
          px(getComputedStyle(el).fontSize) < 16 &&
          seen(el) &&
          !(el instanceof HTMLInputElement && el.disabled)
      )
      .map((el) => ({
        label: `${labelOf(el)} ${getComputedStyle(el).fontSize}${el === document.activeElement ? ', focused' : ''}`,
        rect: rectOf(el),
      }))

  const measure = document.createElement('canvas').getContext('2d')
  /** The width of a line of text in an element's font */
  const textWidth = (text: string, s: CSSStyleDeclaration) => {
    if (!measure) {
      return 0
    }
    measure.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`
    return (
      measure.measureText(text).width +
      px(s.letterSpacing) * [...new Intl.Segmenter().segment(text)].length
    )
  }

  /** A placeholder wider than its field, in the field's font, whether or not it shows now: it does whenever the field is empty */
  const clippedPlaceholders = (): AuditTarget[] =>
    textFields().flatMap((el) => {
      const holder = el.getAttribute('placeholder') ?? ''
      if (!(el instanceof HTMLInputElement) || holder === '' || !seen(el)) {
        return []
      }
      const s = getComputedStyle(el)
      const room = el.clientWidth - px(s.paddingLeft) - px(s.paddingRight)
      const need = textWidth(holder, s)
      return need > room + 1
        ? [
            {
              label: `placeholder of input "${el.getAttribute('aria-label') ?? ''}" "${holder.slice(0, 40)}": ${Math.round(need)}px of text in ${Math.round(room)}px`,
              rect: rectOf(el),
            },
          ]
        : []
    })

  /** A title or aria-label on the element or above it that carries the full text */
  const fullTextOn = (el: Element, text: string) => {
    for (
      let p: Element | null = el;
      p && p !== document.body;
      p = p.parentElement
    ) {
      for (const attr of ['title', 'aria-label']) {
        const v = (p.getAttribute(attr) ?? '').replaceAll(/\s+/gu, ' ').trim()
        if (v !== '' && v.includes(text)) {
          return true
        }
      }
    }
    return false
  }

  // Labels of controls, and headings; content in lists (song titles in rows and options) is cut to one line by design
  const LABELLED =
    'button,[role=button],[role=tab],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=switch],[role=radio],label,summary,legend,h1,h2,h3,h4,h5,h6'

  /** A single-line label cut off by its box (with an ellipsis or not), with no title or aria-label holding its text */
  const truncatedLabels = (): AuditTarget[] =>
    [...document.body.querySelectorAll('*')].flatMap((el) => {
      if (
        el.closest(LABELLED) === null ||
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement
      ) {
        return []
      }
      const s = getComputedStyle(el)
      const single =
        ['nowrap', 'pre'].includes(s.whiteSpace) ||
        s.textOverflow === 'ellipsis'
      if (
        !single ||
        !['hidden', 'clip'].includes(s.overflowX) ||
        el.scrollWidth <= el.clientWidth + 1
      ) {
        return []
      }
      const text = (el.textContent ?? '').replaceAll(/\s+/gu, ' ').trim()
      // seen() leaves out screen-reader-only text, clipped to a pixel on purpose
      return text === '' || !seen(el) || fullTextOn(el, text)
        ? []
        : [
            {
              label: `"${text.slice(0, 48)}" ${el.scrollWidth}px of text in ${el.clientWidth}px, no title: ${describe(el)}`,
              rect: rectOf(el),
            },
          ]
    })

  let atRest: WeakSet<Element> | null = null
  bench.rest = () => {
    // What a person could see: a closed dialog's field, already in the page, is not at rest on screen
    atRest = new WeakSet([...document.querySelectorAll('*')].filter(seen))
  }

  bench.audit = (safe) => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const shown = (el: Element) => {
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return (
        r.width > 0 &&
        r.height > 0 &&
        s.visibility !== 'hidden' &&
        Number(s.opacity) > 0.05 &&
        s.pointerEvents !== 'none' &&
        !el.closest('[inert],[aria-hidden=true]')
      )
    }
    const pinned = (el: Element) => {
      for (let p: Element | null = el; p; p = p.parentElement) {
        const pos = getComputedStyle(p).position
        if (pos === 'fixed' || pos === 'sticky') {
          return true
        }
      }
      return false
    }
    const offView = (r: DOMRect) =>
      r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw
    const inInset = (mx: number, my: number) =>
      Boolean(
        (safe.top && my < safe.top) ||
        (safe.bottom && my > vh - safe.bottom) ||
        (safe.left && mx < safe.left) ||
        (safe.right && mx > vw - safe.right)
      )
    /**
     * Content scrolled under a sticky bar of its own scroll box, inside a fixed layer (a dialog's list under its
     * sticky header or footer): expected, as content under the page's own bars is
     */
    const underOwnStickyBar = (el: Element, hit: Element) => {
      let bar: Element | null = hit
      while (bar && getComputedStyle(bar).position !== 'sticky') {
        bar = bar.parentElement
      }
      const box = bar?.parentElement
      return Boolean(bar && box && box.contains(el) && !bar.contains(el))
    }
    /** What a press at (mx, my) lands on instead of `el`, if anything does */
    const coveredBy = (
      el: Element,
      isPinned: boolean,
      mx: number,
      my: number
    ): Element | null => {
      const hit = document.elementFromPoint(mx, my)
      if (
        hit &&
        !el.contains(hit) &&
        !hit.contains(el) &&
        !(pinned(hit) && !isPinned) &&
        !underOwnStickyBar(el, hit)
      ) {
        const owner = hit.closest(
          'a[href],button,input,select,textarea,summary,[role=button],[role=slider],[role=tab],[tabindex]'
        )
        return owner ?? hit
      }
      return null
    }
    // An open modal dialog makes the rest of the page inert: only what it holds can be pressed
    const modal = document.querySelector('dialog:modal')
    const all = [...document.querySelectorAll(TARGETS)].filter(
      (el) =>
        !(el instanceof HTMLElement && el.dataset.benchIgnore !== undefined) &&
        (modal === null || modal.contains(el))
    )
    // Nested targets (a button inside a link) count once, as the outer one
    const targets = all
      .filter(shown)
      .filter((el) => !all.some((o) => o !== el && o.contains(el)))
    const small: AuditTarget[] = []
    const occluded: { label: string; by: string }[] = []
    const offscreen: AuditTarget[] = []
    const unsafe: AuditTarget[] = []
    // A phone by its insets, or by its finger (the 320px view has no insets)
    const phone =
      safe.top + safe.bottom + safe.left + safe.right > 0 ||
      matchMedia('(pointer: coarse)').matches
    let count = 0
    for (const el of targets) {
      const full = el.getBoundingClientRect()
      const r = clipped(el)
      if (!r || offView(r)) {
        continue
      }
      count += 1
      const target = { label: labelOf(el), rect: rectOf(el) }
      // WCAG 2.2 target size (minimum): 24 × 24 CSS px. A slider thumb is exempt: its track takes the press
      if (
        (full.width < 24 || full.height < 24) &&
        el.getAttribute('role') !== 'slider'
      ) {
        small.push(target)
      }
      // Cut off by the viewport's side edges, not by a scroll box it can be scrolled into view in
      if (r.left < -1 || r.right > vw + 1) {
        offscreen.push(target)
      }
      // Fixed or sticky controls on a phone must stay pressable clear of the status bar, home indicator and side
      // notches: their centre may not fall inside an inset (padding reaching into one is fine)
      const isPinned = pinned(el)
      const mx = r.left + r.width / 2
      const my = r.top + r.height / 2
      if (phone && isPinned && inInset(mx, my)) {
        unsafe.push(target)
      }
      // The press lands where the finger lands: the centre of the visible part must hit this element.
      // Content scrolled under a fixed or sticky bar is expected and not counted; a pinned control covered by
      // anything, or content covered by other content, is.
      const by = coveredBy(el, isPinned, mx, my)
      // An opened menu or field covers what was under it: that is what opening it does. What the state opened is
      // still checked against everything
      const openedOver =
        by !== null && atRest !== null && atRest.has(el) && !atRest.has(by)
      if (by && !openedOver) {
        occluded.push({ by: labelOf(by), label: target.label })
      }
    }
    // The accessible name, as browsers compute it for the cases this app has: aria-labelledby, aria-label, a
    // field's label or placeholder, then the content (skipping aria-hidden parts; an image's alt, an svg's title),
    // then title. Dialogs and text fields don't take a name from their content
    const contentName = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent ?? ''
      }
      if (
        !(node instanceof Element) ||
        node.getAttribute('aria-hidden') === 'true'
      ) {
        return ''
      }
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') {
        return ''
      }
      const label = (node.getAttribute('aria-label') ?? '').trim()
      if (label !== '') {
        return label
      }
      if (node instanceof HTMLImageElement) {
        return node.alt
      }
      if (node.tagName.toLowerCase() === 'svg') {
        return node.querySelector('title')?.textContent ?? ''
      }
      return [...node.childNodes].map(contentName).join(' ')
    }
    const labelledBy = (el: Element) =>
      (el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/u)
        .filter((id) => id !== '')
        .map(
          (id) =>
            document.querySelector(`#${CSS.escape(id)}`)?.textContent ?? ''
        )
        .join(' ')
        .trim()
    // A <label for> names any labelable element: fields, and buttons too (the Autoplay switch)
    const labelsOf = (el: Element) =>
      'labels' in el && el.labels instanceof NodeList
        ? [...el.labels]
            .map((l) => l.textContent ?? '')
            .join(' ')
            .trim()
        : ''
    const fieldName = (
      el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    ) => {
      if (
        el instanceof HTMLInputElement &&
        ['button', 'submit', 'reset'].includes(el.type)
      ) {
        return el.value
      }
      return (el.getAttribute('placeholder') ?? '').trim()
    }
    // Dialogs and text fields don't take a name from their content
    const NO_CONTENT_NAME = new Set([
      'alertdialog',
      'combobox',
      'dialog',
      'searchbox',
      'textbox',
    ])
    const ownName = (el: Element) => {
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement
      ) {
        return fieldName(el)
      }
      const role = el.getAttribute('role') ?? el.tagName.toLowerCase()
      return NO_CONTENT_NAME.has(role)
        ? ''
        : contentName(el).replaceAll(/\s+/gu, ' ').trim()
    }
    // The accessible name, as browsers compute it for what this app has: aria-labelledby, aria-label, a field's
    // label or placeholder, the content (skipping aria-hidden parts; an image's alt, an svg's title), then title
    const nameOf = (el: Element): string =>
      [
        labelledBy(el),
        (el.getAttribute('aria-label') ?? '').trim(),
        labelsOf(el),
        ownName(el),
        (el.getAttribute('title') ?? '').trim(),
      ].find((name) => name !== '') ?? ''
    // Unnamed things have no label to tell them apart: their first classes do
    const withClass = (el: Element) =>
      `${labelOf(el)} .${(el.getAttribute('class') ?? '').split(/\s+/u).slice(0, 4).join('.')}`
    const NAMED =
      'a[href],button,input:not([type=hidden]),select,textarea,dialog[open],[role=button],[role=link],[role=slider],[role=switch],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=checkbox],[role=radio],[role=combobox],[role=option],[role=textbox],[role=searchbox],[role=dialog],[role=alertdialog]'
    const unnamed = [...document.querySelectorAll(NAMED)]
      .filter((el) => (modal === null || modal.contains(el)) && shown(el))
      .filter((el) => nameOf(el) === '')
      .map((el) => ({ label: withClass(el), rect: rectOf(el) }))
    const FOCUSABLE =
      'a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select,textarea,summary,iframe,[tabindex]:not([tabindex="-1"])'
    const unscrollable = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const s = getComputedStyle(el)
        return (
          (/auto|scroll/u.test(s.overflowY) &&
            el.scrollHeight > el.clientHeight + 4) ||
          (/auto|scroll/u.test(s.overflowX) &&
            el.scrollWidth > el.clientWidth + 4)
        )
      })
      .filter(
        (el) =>
          el !== document.scrollingElement &&
          shown(el) &&
          !el.matches(FOCUSABLE) &&
          el.querySelector(FOCUSABLE) === null &&
          // A list a focused combobox drives (aria-controls, aria-activedescendant) is reached through the field
          !(
            el.id !== '' &&
            document.querySelector(`[aria-controls="${CSS.escape(el.id)}"]`) !==
              null
          )
      )
      .map((el) => ({ label: withClass(el), rect: rectOf(el) }))
    return {
      clipped: [...clippedPlaceholders(), ...truncatedLabels()],
      insetSurfaces: phone ? insetSurfacesOf(safe) : [],
      occluded,
      offscreen,
      overflowX: Math.max(0, document.documentElement.scrollWidth - vw),
      pan: panOf(),
      small,
      targets: count,
      unnamed,
      unsafe,
      unscrollable,
      viewport: { h: vh, w: vw },
      zoomInputs: phone ? zoomInputsOf() : [],
    }
  }
}

export const RECORDER = `(${recorder.toString()})(${JSON.stringify(WATCH)}, ${JSON.stringify(INSET_BACKDROPS)})`
