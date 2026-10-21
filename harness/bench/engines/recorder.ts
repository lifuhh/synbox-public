// Runs inside the page before any app script (an init script). It seeds Math.random, timestamps when watched
// elements first become visible, records paint metrics, long tasks, player phases and lyric line changes, and
// offers a frame recorder and a layout audit. Every time is performance.now(), ms after navigation start.

/* oxlint-disable unicorn/consistent-function-scoping -- recorder() is serialised with toString() and injected into the page, so every helper it uses must be declared inside it */

import type { Rect } from '../types'

/** Named elements to timestamp. `img: true` waits until an image inside has decoded, not just the box */
export const WATCH: Record<string, { selector: string; img?: boolean }> = {
  'carousel-slide': {
    img: true,
    selector:
      'section[aria-label=Recommendations] .carousel-track a[href^="/v/"]',
  },
  // Every chart row in, both playlist pages fetched (deleted or private videos drop out, so not always 100)
  'charts-done': {
    selector:
      'section[aria-labelledby=charts-title][aria-busy=false] ul:not([aria-hidden]) > li',
  },
  'charts-row': {
    selector:
      'section[aria-labelledby=charts-title] ul:not([aria-hidden]) > li > a[href^="/v/"]',
  },
  'gallery-tile': {
    img: true,
    selector: 'section[aria-labelledby=gallery-title] ul > li a[href^="/v/"]',
  },
  'hero-input': {
    selector: 'input[placeholder="Search or paste a YouTube URL"]',
  },
  'lyrics-line': { selector: '.player-lyrics-overlay p.lyric-text-line' },
  // The YouTube player lives in one persistent layer at the top of the body, outside the stage
  'player-iframe': {
    selector: '[data-stage-video] iframe, [data-player-stage] iframe',
  },
  'search-result': { img: true, selector: 'button:has(> div > img)' },
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
  landmarks: Record<string, Rect>
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
      audit: (safe: {
        top: number
        bottom: number
        left: number
        right: number
      }) => Audit
    }
  }
}

const recorder = (watch: typeof WATCH) => {
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
      document.querySelector('.player-lyrics-overlay p.lyric-text-line')
        ?.textContent ?? ''
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

  bench.audit = (safe) => {
    const vw = window.innerWidth
    const vh = window.innerHeight
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
        !(pinned(hit) && !isPinned)
      ) {
        const owner = hit.closest(
          'a[href],button,input,select,textarea,summary,[role=button],[role=slider],[role=tab],[tabindex]'
        )
        return owner ?? hit
      }
      return null
    }
    const all = [
      ...document.querySelectorAll(
        'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=slider],[role=tab],[tabindex]:not([tabindex="-1"])'
      ),
    ].filter(
      (el) =>
        !(el instanceof HTMLElement && el.dataset.benchIgnore !== undefined)
    )
    // Nested targets (a button inside a link) count once, as the outer one
    const targets = all
      .filter(shown)
      .filter((el) => !all.some((o) => o !== el && o.contains(el)))
    const small: AuditTarget[] = []
    const occluded: { label: string; by: string }[] = []
    const offscreen: AuditTarget[] = []
    const unsafe: AuditTarget[] = []
    const phone = safe.top + safe.bottom + safe.left + safe.right > 0
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
      if (by) {
        occluded.push({ by: labelOf(by), label: target.label })
      }
    }
    const landmarks: Record<string, Rect> = {}
    for (const [name, sel] of Object.entries({
      carousel: 'section[aria-label=Recommendations]',
      charts: 'section[aria-labelledby=charts-title]',
      controls: '[data-player-chrome]',
      'gallery-title': '#gallery-title',
      'hero-input': 'input[placeholder="Search or paste a YouTube URL"]',
      lyrics: '.player-lyrics-overlay',
      stage: '[data-player-stage]',
      topbar: '[data-topbar]',
    })) {
      const el = document.querySelector(sel)
      if (el && el.getBoundingClientRect().width > 0) {
        landmarks[name] = rectOf(el)
      }
    }
    return {
      landmarks,
      occluded,
      offscreen,
      overflowX: Math.max(0, document.documentElement.scrollWidth - vw),
      small,
      targets: count,
      unsafe,
      viewport: { h: vh, w: vw },
    }
  }
}

export const RECORDER = `(${recorder.toString()})(${JSON.stringify(WATCH)})`
