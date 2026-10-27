// A motion audit for any morph, where one element turns into another (home's search field flying into the top bar's
// search and back). It drives the real transition, records every part's box and opacity on every rendered frame, and
// judges the frames against four rules:
//
// - teleport: nothing jumps between frames. An element's opacity changes by at most POP_STEP a frame (one not there
//   counts as 0), unless another element of the same part takes over in the same place, within HANDOVER_PX (the real
//   field handing over to its copy in flight); a part attached to another moves with it, its anchored edge shifting
//   no more than STEP_PX against the container's in one frame; a free part's edge never steps more than the page's
//   own scroll plus FREE_STEP_PX. POP_STEP and FREE_STEP_PX are per 60Hz frame: a frame that came late may move
//   that much for each frame it took (a stalled headless WebKit frame is a late frame, not a jump).
// - scale: in a morph that grows nothing shrinks, and in one that shrinks nothing grows: every element's width and
//   height move the morph's way only (beyond NOISE_PX); in a part that keeps its size, they never turn back.
// - detached: an attached part stays inside its container's box (within NOISE_PX), and drifts from its anchor no
//   more than its own `drift`, when it has one.
// - frame: while anything moves, no frame takes the page over FRAME_MS of main-thread work (from the frame's start
//   to its layout). The gap between frames is reported too (`late`), not judged: a headless browser's frame clock is
//   uneven, and an idle page shows the same gaps (2026-10-27: 8% of idle frames on desktop Chromium over 25ms).
//
// Thresholds, from the hero flight measured frame by frame (2026-10-27, desktop Chromium and iPhone WebKit): a
// critically damped 0.45 s spring across ~330px moves a box at most ~30px a frame, so FREE_STEP_PX (40, on top of the
// scroll) passes any spring and catches a jump; a part riding its container's edge moves under 2px a frame against
// it, so STEP_PX is 3; HANDOVER_PX is the 0.5px a hand-off from a moving copy to the real element may miss by;
// POP_STEP 0.5 is a fade of fewer than two frames.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { Page } from 'playwright'

import { open } from '../engines/browser'
import type { BenchContext, Sample, Surface } from '../types'
import { LAYOUT_PAGES } from './layout'

const LIMIT_MS = 120_000
const POP_STEP = 0.5
const HANDOVER_PX = 0.5
const STEP_PX = 3
const FREE_STEP_PX = 40
const NOISE_PX = 1
const FRAME_MS = 25
const VSYNC_MS = 1000 / 60
/** An element this faint, or with no area left on screen, isn't shown */
const SHOWN_OPACITY = 0.02
/** Frames in a row with nothing moving: the transition is over */
const QUIET_FRAMES = 20
const SETTLE_MS = 4000
/** Notes kept per rule and part in a pass; the counts have the rest */
const NOTES_PER = 2

type Edge = 'start' | 'centre' | 'end'

/** One element of the morph, followed through every element that draws it: the real one, its copies in flight */
export interface MorphPart {
  name: string
  /** Every element that draws this part on some frame (a comma list): the source, the copies in flight, the target */
  selector: string
  /** Judge the text's own extent (an input's value or placeholder, or the element's text), not its box */
  text?: true
  /**
   * The part it belongs to and moves with: the edge it keeps to on each axis, and how far it may drift from where
   * it first showed against that edge
   */
  within?: { part: string; x: Edge; y: Edge; drift?: number }
}

export interface MorphPass {
  name: string
  /** Starts the transition in the page; resolves once its input is done (the motion may still run) */
  drive: (page: Page, ms: number) => Promise<void>
}

export interface Morph {
  name: string
  path: string
  ready: (page: Page) => Promise<void>
  /** The first part is the morph itself (the box that turns into the other); it decides the growing direction */
  parts: MorphPart[]
  /** The page's scroller, read each frame so a part carried by the scroll isn't mistaken for a jump */
  scroller: string
  passes: MorphPass[]
  /** How long each drive takes, every pass run at each */
  speeds: { name: string; ms: number }[]
}

export interface Shown {
  id: number
  l: number
  t: number
  r: number
  b: number
  /** Opacity, through every ancestor */
  o: number
  /** Area left on screen once its clipping ancestors and the viewport cut it */
  a: number
}

export interface Frame {
  /** When the frame was laid out, ready to paint */
  t: number
  /** The page's main-thread time in this frame, from its start to layout done (the probe's own reads excluded) */
  work: number
  scroll: number
  parts: Record<string, Shown[]>
}

/* oxlint-disable unicorn/consistent-function-scoping -- the recorder runs in the page: nothing outside it is there */
/** Installs the frame recorder in the page: one sample per rendered frame, after layout, before paint */
const startRecording = async (
  page: Page,
  parts: MorphPart[],
  scroller: string
): Promise<void> => {
  await page.evaluate(
    ({ list, scrollerSelector, shownOpacity }) => {
      const ids = new WeakMap<Element, number>()
      let next = 1
      const idOf = (el: Element) => {
        const known = ids.get(el)
        if (known !== undefined) {
          return known
        }
        next += 1
        ids.set(el, next)
        return next
      }
      const px = (v: string) => Number(v.replace('px', ''))
      // Words are measured as the page lays them out, in a hidden line of the same type: a canvas measures in whatever
      // the font has loaded so far, which differs from what the input draws while fonts still load
      const ruler = document.createElement('span')
      ruler.style.cssText =
        'position:fixed;left:-10000px;top:0;white-space:pre;visibility:hidden;pointer-events:none'
      document.body.append(ruler)
      // Measured once per type and words (a layout per frame slowed the page), again once a font finishes loading
      const widths = new Map<string, number>()
      document.fonts.addEventListener('loadingdone', () => {
        widths.clear()
      })
      const opacityOf = (el: Element) => {
        let o = 1
        for (let n: Element | null = el; n !== null; n = n.parentElement) {
          const cs = getComputedStyle(n)
          if (cs.visibility === 'hidden' || cs.display === 'none') {
            return 0
          }
          o *= Number(cs.opacity)
        }
        return o
      }
      // What is left of a box on screen once every clipping ancestor and the viewport have cut it
      const shownArea = (el: Element, box: DOMRect) => {
        let l = Math.max(box.left, 0)
        let t = Math.max(box.top, 0)
        let r = Math.min(box.right, innerWidth)
        let b = Math.min(box.bottom, innerHeight)
        for (let n = el.parentElement; n !== null; n = n.parentElement) {
          const cs = getComputedStyle(n)
          if (
            cs.overflowX !== 'visible' ||
            cs.overflowY !== 'visible' ||
            cs.contain.includes('paint')
          ) {
            const c = n.getBoundingClientRect()
            l = Math.max(l, c.left)
            t = Math.max(t, c.top)
            r = Math.min(r, c.right)
            b = Math.min(b, c.bottom)
          }
        }
        return Math.max(r - l, 0) * Math.max(b - t, 0)
      }
      // The words' own box: an input's value or placeholder measured in its font, scaled as the input is drawn
      const textBox = (el: Element, box: DOMRect) => {
        if (el instanceof HTMLInputElement) {
          const cs = getComputedStyle(el)
          const scale = el.offsetWidth > 0 ? box.width / el.offsetWidth : 1
          const words = el.value === '' ? el.placeholder : el.value
          const type = `${cs.fontStyle}|${cs.fontWeight}|${cs.fontSize}|${cs.letterSpacing}|${cs.fontFamily}|${words}`
          let width = widths.get(type)
          if (width === undefined) {
            Object.assign(ruler.style, {
              fontFamily: cs.fontFamily,
              fontSize: cs.fontSize,
              fontStyle: cs.fontStyle,
              fontWeight: cs.fontWeight,
              letterSpacing: cs.letterSpacing,
            })
            ruler.textContent = words
            ;({ width } = ruler.getBoundingClientRect())
            widths.set(type, width)
          }
          const room = el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight)
          const left =
            box.left + (px(cs.borderLeftWidth) + px(cs.paddingLeft)) * scale
          const size = px(cs.fontSize) * scale
          const mid = box.top + box.height / 2
          return {
            b: mid + size / 2,
            l: left,
            r: left + Math.min(width, room) * scale,
            t: mid - size / 2,
          }
        }
        const range = document.createRange()
        range.selectNodeContents(el)
        const r = range.getBoundingClientRect()
        return { b: r.bottom, l: r.left, r: r.right, t: r.top }
      }
      const round = (v: number) => Math.round(v * 100) / 100
      const scrollBox = document.querySelector(scrollerSelector)
      const frames: Frame[] = []
      let last = ''
      let on = true
      let frameStart = performance.now()
      const state = {
        frames,
        quiet: 0,
        stop: () => {
          on = false
        },
      }
      const sample = () => {
        const laidOut = performance.now()
        const seen: Record<string, Shown[]> = {}
        for (const part of list) {
          seen[part.name] = [
            ...new Set(document.querySelectorAll(part.selector)),
          ].flatMap((el) => {
            const box = el.getBoundingClientRect()
            if (box.width === 0 && box.height === 0) {
              return []
            }
            const o = opacityOf(el)
            const at =
              part.text === true
                ? textBox(el, box)
                : { b: box.bottom, l: box.left, r: box.right, t: box.top }
            return [
              {
                a: o >= shownOpacity ? round(shownArea(el, box)) : 0,
                b: round(at.b),
                id: idOf(el),
                l: round(at.l),
                o: Math.round(o * 1000) / 1000,
                r: round(at.r),
                t: round(at.t),
              },
            ]
          })
        }
        const key = JSON.stringify(seen)
        state.quiet = key === last ? state.quiet + 1 : 0
        last = key
        frames.push({
          parts: seen,
          scroll: scrollBox?.scrollTop ?? scrollY,
          t: laidOut,
          work: laidOut - frameStart,
        })
      }
      // A ResizeObserver runs after every requestAnimationFrame callback and layout, just before paint: each sample is
      // the frame as painted, whatever order the page's own frame callbacks run in
      const tick = document.createElement('div')
      tick.style.cssText =
        'position:fixed;top:0;left:0;width:1px;height:1px;pointer-events:none;visibility:hidden'
      document.body.append(tick)
      const observer = new ResizeObserver(sample)
      observer.observe(tick)
      let flip = false
      const loop = (now: number) => {
        if (!on) {
          observer.disconnect()
          tick.remove()
          ruler.remove()
          return
        }
        // The frame's start: every animation callback of a frame gets the same time
        frameStart = now
        flip = !flip
        tick.style.width = flip ? '2px' : '1px'
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
      Object.assign(globalThis, { __motion: state })
    },
    {
      list: parts.map((p) => ({
        name: p.name,
        selector: p.selector,
        text: p.text,
      })),
      scrollerSelector: scroller,
      shownOpacity: SHOWN_OPACITY,
    }
  )
}
/* oxlint-enable unicorn/consistent-function-scoping */

const frameCount = async (page: Page) =>
  await page.evaluate(() => {
    const found: unknown = Reflect.get(globalThis, '__motion')
    return typeof found === 'object' &&
      found !== null &&
      'frames' in found &&
      Array.isArray(found.frames)
      ? found.frames.length
      : 0
  })

/** Waits until nothing has moved for QUIET_FRAMES frames, or SETTLE_MS */
const settled = async (page: Page): Promise<void> => {
  await page
    .waitForFunction(
      (quiet) => {
        const found: unknown = Reflect.get(globalThis, '__motion')
        return (
          typeof found === 'object' &&
          found !== null &&
          'quiet' in found &&
          typeof found.quiet === 'number' &&
          found.quiet >= quiet
        )
      },
      QUIET_FRAMES,
      { polling: 50, timeout: SETTLE_MS }
    )
    .catch(() => {
      // Still moving after SETTLE_MS: judged as it is
    })
}

/** Stops the recorder and returns its frames */
const recorded = async (page: Page): Promise<Frame[]> =>
  await page.evaluate(() => {
    const found: unknown = Reflect.get(globalThis, '__motion')
    if (
      typeof found !== 'object' ||
      found === null ||
      !('stop' in found) ||
      !('frames' in found) ||
      typeof found.stop !== 'function'
    ) {
      throw new Error('no motion recorder in the page')
    }
    // oxlint-disable-next-line typescript/no-unsafe-call -- the recorder's own stop(), installed by startRecording
    found.stop()
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the recorder's own frames, installed by startRecording
    return found.frames as Frame[]
  })

/** Scrolls `scroller` to `to` over `ms`, eased in and out as a flick is, one step per frame */
export const easedScroll = async (
  page: Page,
  scroller: string,
  to: number,
  ms: number
): Promise<void> => {
  await page.evaluate(
    async ({ selector, target, duration }) => {
      const box = document.querySelector<HTMLElement>(selector)
      if (box === null) {
        throw new Error(`no scroller ${selector}`)
      }
      const from = box.scrollTop
      const start = performance.now()
      // oxlint-disable-next-line promise/avoid-new -- the scroll's frames as one promise
      await new Promise<void>((resolve) => {
        const step = (now: number) => {
          const k = Math.min((now - start) / duration, 1)
          const eased = k * k * (3 - 2 * k)
          box.scrollTo({
            behavior: 'instant',
            top: from + (target - from) * eased,
          })
          if (k < 1) {
            requestAnimationFrame(step)
          } else {
            resolve()
          }
        }
        requestAnimationFrame(step)
      })
    },
    { duration: ms, selector: scroller, target: to }
  )
}

// The judge: pure, over recorded frames

const shown = (e: Shown) => e.o >= SHOWN_OPACITY && e.a >= 1
const shownOf = (f: Frame, part: string) => (f.parts[part] ?? []).filter(shown)
const primary = (f: Frame, part: string): Shown | null =>
  shownOf(f, part).toSorted((a, b) => b.o - a.o)[0] ?? null
const sameBox = (a: Shown, b: Shown, px: number) =>
  Math.abs(a.l - b.l) <= px &&
  Math.abs(a.r - b.r) <= px &&
  Math.abs(a.t - b.t) <= px &&
  Math.abs(a.b - b.b) <= px
const boxText = (e: Shown) =>
  `(${e.l.toFixed(1)},${e.t.toFixed(1)} ${(e.r - e.l).toFixed(1)}×${(e.b - e.t).toFixed(1)})`

/** Where an element sits against its container's edge on one axis */
const along = (e: Shown, c: Shown, axis: 'x' | 'y', edge: Edge) => {
  const [lo, hi, clo, chi] =
    axis === 'x' ? [e.l, e.r, c.l, c.r] : [e.t, e.b, c.t, c.b]
  if (edge === 'start') {
    return lo - clo
  }
  if (edge === 'end') {
    return hi - chi
  }
  return (lo + hi) / 2 - (clo + chi) / 2
}

/** How far a container's own edge moved on one axis between two frames */
const edgeStep = (c0: Shown, c1: Shown, axis: 'x' | 'y', edge: Edge) => {
  const [lo0, hi0, lo1, hi1] =
    axis === 'x' ? [c0.l, c0.r, c1.l, c1.r] : [c0.t, c0.b, c1.t, c1.b]
  if (edge === 'start') {
    return lo1 - lo0
  }
  if (edge === 'end') {
    return hi1 - hi0
  }
  return (lo1 + hi1 - lo0 - hi0) / 2
}

const EDGE_NAMES = {
  x: { centre: 'centre', end: 'right edge', start: 'left edge' },
  y: { centre: 'centre line', end: 'bottom edge', start: 'top edge' },
}
const WAYS = { x: ['left', 'right'], y: ['up', 'down'] }

/** A change bigger than noise, as -1, 0 or 1 */
const signOf = (from: number, to: number) =>
  Math.abs(to - from) > NOISE_PX ? Math.sign(to - from) : 0

export type Rule = 'teleport' | 'scale' | 'detached' | 'frame'

type Flag = (rule: Rule, part: string, frame: number, text: string) => void

interface Step {
  n: number
  prev: Frame
  cur: Frame
  /** How many 60Hz frames the step took (at least 1): a stalled frame moves further and is judged per frame it took */
  span: number
}

const steps = (frames: Frame[]): Step[] =>
  frames.slice(1).flatMap((cur, i) => {
    const prev = frames[i]
    return prev === undefined
      ? []
      : [
          {
            cur,
            n: i + 1,
            prev,
            span: Math.max((cur.t - prev.t) / VSYNC_MS, 1),
          },
        ]
  })

const movedBetween = (parts: MorphPart[], a: Frame, b: Frame) =>
  parts.some((p) => {
    const x = shownOf(a, p.name)
    const y = shownOf(b, p.name)
    return (
      x.length !== y.length ||
      x.some((e, i) => {
        const o = y[i]
        return (
          o === undefined ||
          o.id !== e.id ||
          !sameBox(e, o, 0.1) ||
          Math.abs(e.o - o.o) > 0.005
        )
      })
    )
  })

/** Two boxes the same within a hand-over's tolerance */
const meets = (a: Shown, b: Shown) => sameBox(a, b, HANDOVER_PX)

/** How far a part jumped, from where it showed to where it showed next */
const jumpText = (from: Shown, to: Shown) => {
  const dx = to.l - from.l
  const dy = to.t - from.t
  return ` (a jump of ${Math.abs(dx).toFixed(1)}px ${WAYS.x[dx < 0 ? 0 : 1]}, ${Math.abs(dy).toFixed(1)}px ${WAYS.y[dy < 0 ? 0 : 1]})`
}

/**
 * Showing and hiding go by a ramp of opacity, or by a hand-over: another element of the part shows in the same
 * place, where the one before was last drawn or, still there unseen, where it is now (both riding a moving bar)
 */
const judgePops = (p: MorphPart, { n, prev, cur, span }: Step, flag: Flag) => {
  const was = prev.parts[p.name] ?? []
  const now = cur.parts[p.name] ?? []
  const wasShown = was.filter(shown)
  const nowShown = now.filter(shown)
  const nowOf = (id: number) => now.find((q) => q.id === id)
  for (const id of new Set([...wasShown, ...nowShown].map((e) => e.id))) {
    const before = was.find((q) => q.id === id)
    const after = nowOf(id)
    const from = before?.o ?? 0
    const to = after?.o ?? 0
    const appearing = to > from
    const others = (appearing ? wasShown : nowShown).filter((q) => q.id !== id)
    const handedOver = appearing
      ? after !== undefined &&
        others.some((q) => {
          const there = nowOf(q.id)
          return meets(q, after) || (there !== undefined && meets(there, after))
        })
      : before !== undefined &&
        others.some(
          (q) => meets(before, q) || (after !== undefined && meets(after, q))
        )
    const at = appearing ? after : before
    if (
      at !== undefined &&
      Math.abs(to - from) > POP_STEP * span &&
      !handedOver
    ) {
      const [other] = others
      const there =
        other === undefined
          ? 'nothing else of it showed'
          : `it showed at ${boxText(other)}${appearing ? jumpText(other, at) : jumpText(at, other)}`
      flag(
        'teleport',
        p.name,
        n,
        `${appearing ? 'appeared' : 'vanished'}: opacity ${from.toFixed(2)} → ${to.toFixed(2)} in one frame at ${boxText(at)}; ${appearing ? 'the frame before' : 'that frame'}, ${there}`
      )
    }
  }
}

/** A free part's edges step no further than the scroll plus a spring's stride */
const judgeFreeSteps = (
  p: MorphPart,
  { n, prev, cur, span }: Step,
  flag: Flag
) => {
  const scrolled = Math.abs(cur.scroll - prev.scroll)
  for (const e of shownOf(cur, p.name)) {
    const before = shownOf(prev, p.name).find((q) => q.id === e.id)
    const step =
      before === undefined
        ? 0
        : Math.max(
            Math.abs(e.l - before.l),
            Math.abs(e.r - before.r),
            Math.abs(e.t - before.t),
            Math.abs(e.b - before.b)
          )
    if (step > scrolled + FREE_STEP_PX * span) {
      flag(
        'teleport',
        p.name,
        n,
        `an edge moved ${step.toFixed(1)}px in one frame (the page scrolled ${scrolled.toFixed(1)}px)`
      )
    }
  }
}

/** An attached part moves with its container's edge, frame to frame, and stays inside its box */
const judgeAttached = (p: MorphPart, { n, prev, cur }: Step, flag: Flag) => {
  if (p.within === undefined) {
    return
  }
  const { part } = p.within
  const c0 = primary(prev, part)
  const c1 = primary(cur, part)
  if (c0 === null || c1 === null) {
    return
  }
  for (const e of shownOf(cur, p.name)) {
    const out = Math.max(c1.l - e.l, e.r - c1.r, c1.t - e.t, e.b - c1.b)
    if (out > NOISE_PX) {
      flag(
        'detached',
        p.name,
        n,
        `${out.toFixed(1)}px outside ${part} ${boxText(c1)} at ${boxText(e)}`
      )
    }
    const before = shownOf(prev, p.name).find((q) => q.id === e.id)
    if (before === undefined) {
      continue
    }
    for (const axis of ['x', 'y'] as const) {
      const edge = p.within[axis]
      const step = along(e, c1, axis, edge) - along(before, c0, axis, edge)
      if (Math.abs(step) > STEP_PX) {
        flag(
          'teleport',
          p.name,
          n,
          `moved ${Math.abs(step).toFixed(1)}px ${WAYS[axis][step < 0 ? 0 : 1]} of ${part}'s ${EDGE_NAMES[axis][edge]} in one frame (that edge itself moved ${edgeStep(c0, c1, axis, edge).toFixed(1)}px)`
        )
      }
    }
  }
}

/** An attached part with a `drift` stays within it of where it first showed against its container's edges */
const judgeDrift = (frames: Frame[], p: MorphPart, flag: Flag) => {
  const drift = p.within?.drift
  if (p.within === undefined || drift === undefined) {
    return
  }
  const { part, x, y } = p.within
  const first = new Map<number, { x: number; y: number }>()
  for (const [n, f] of frames.entries()) {
    const c = primary(f, part)
    for (const e of c === null ? [] : shownOf(f, p.name)) {
      const at =
        c === null ? null : { x: along(e, c, 'x', x), y: along(e, c, 'y', y) }
      const from = first.get(e.id)
      if (at !== null && from === undefined) {
        first.set(e.id, at)
      }
      const off =
        at === null || from === undefined
          ? 0
          : Math.max(Math.abs(at.x - from.x), Math.abs(at.y - from.y))
      if (off > drift) {
        flag(
          'detached',
          p.name,
          n,
          `${off.toFixed(1)}px from where it showed against ${part}'s ${EDGE_NAMES.x[x]} and ${EDGE_NAMES.y[y]} (allowed ${drift}px)`
        )
      }
    }
  }
}

/** How far a size series ever went against `way` (-1 shrinking, 1 growing; 0: any turn back), and where */
const against = (sizes: { n: number; v: number }[], way: number) => {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  let worst = { by: 0, n: 0 }
  for (const { n, v } of sizes) {
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
    const up = v - lo
    const down = hi - v
    let by = Math.min(up, down)
    if (way < 0) {
      by = up
    } else if (way > 0) {
      by = down
    }
    if (by > worst.by) {
      worst = { by, n }
    }
  }
  return worst
}

/** Every element's width and height move one way: the morph's (its first part's, first frame to last) */
const judgeScale = (frames: Frame[], parts: MorphPart[], flag: Flag) => {
  const [root] = parts
  const ends = frames
    .map((f) => (root === undefined ? null : primary(f, root.name)))
    .filter((e) => e !== null)
  const [first] = ends
  const last = ends.at(-1)
  const way =
    first === undefined || last === undefined
      ? { h: 0, w: 0 }
      : {
          h: signOf(first.b - first.t, last.b - last.t),
          w: signOf(first.r - first.l, last.r - last.l),
        }
  for (const p of parts) {
    const series = new Map<number, { n: number; w: number; h: number }[]>()
    for (const [n, f] of frames.entries()) {
      for (const e of shownOf(f, p.name)) {
        series.set(e.id, [
          ...(series.get(e.id) ?? []),
          { h: e.b - e.t, n, w: e.r - e.l },
        ])
      }
    }
    for (const list of series.values()) {
      for (const dim of ['w', 'h'] as const) {
        const d = way[dim]
        const worst = against(
          list.map((s) => ({ n: s.n, v: s[dim] })),
          d
        )
        if (worst.by > NOISE_PX) {
          const name = dim === 'w' ? 'width' : 'height'
          flag(
            'scale',
            p.name,
            worst.n,
            d === 0
              ? `${name} turned back by ${worst.by.toFixed(1)}px`
              : `${name} went ${d < 0 ? 'up' : 'down'} by ${worst.by.toFixed(1)}px in a morph that ${d < 0 ? 'shrinks' : 'grows'}`
          )
        }
      }
    }
  }
}

export interface Judged {
  counts: Record<Rule, number>
  /** Frames over FRAME_MS after the one before, while moving: reported, not judged (see the top of this file) */
  late: number
  /** The morph's own part was drawn by more than one element: it handed over, so the pass flew */
  flight: boolean
  seen: Set<string>
  notes: string[]
}

/** One pass's frames, judged against the four rules */
export const judge = (frames: Frame[], parts: MorphPart[]): Judged => {
  const counts: Record<Rule, number> = {
    detached: 0,
    frame: 0,
    scale: 0,
    teleport: 0,
  }
  const kept = new Map<string, number>()
  const notes: string[] = []
  const flag: Flag = (rule, part, frame, text) => {
    counts[rule] += 1
    const key = `${rule} ${part}`
    const n = (kept.get(key) ?? 0) + 1
    kept.set(key, n)
    if (n <= NOTES_PER) {
      notes.push(`${rule}: ${part}, frame ${frame}: ${text}`)
    }
  }
  let late = 0
  for (const s of steps(frames)) {
    if (movedBetween(parts, s.prev, s.cur)) {
      if (s.cur.work > FRAME_MS) {
        flag(
          'frame',
          'page',
          s.n,
          `${s.cur.work.toFixed(1)}ms of main-thread work in one frame while moving`
        )
      }
      late += s.cur.t - s.prev.t > FRAME_MS ? 1 : 0
    }
    for (const p of parts) {
      judgePops(p, s, flag)
      if (p.within === undefined) {
        judgeFreeSteps(p, s, flag)
      } else {
        judgeAttached(p, s, flag)
      }
    }
  }
  for (const p of parts) {
    judgeDrift(frames, p, flag)
  }
  judgeScale(frames, parts, flag)
  const [root] = parts
  const seen = new Set(
    parts
      .filter((p) => frames.some((f) => shownOf(f, p.name).length > 0))
      .map((p) => p.name)
  )
  const rootIds = new Set(
    frames.flatMap((f) =>
      root === undefined ? [] : shownOf(f, root.name).map((e) => e.id)
    )
  )
  return { counts, flight: rootIds.size > 1, late, notes, seen }
}

const RULES: Rule[] = ['teleport', 'scale', 'detached', 'frame']

const runMotion = async (
  morph: Morph,
  surface: Surface,
  origin: string,
  artifactDir: string,
  minFlights: number
): Promise<Sample> => {
  const { page, close } = await open(surface)
  try {
    await page.goto(`${origin}${morph.path}`, { waitUntil: 'commit' })
    await morph.ready(page)
    await page.waitForTimeout(500)
    await startRecording(page, morph.parts, morph.scroller)
    const cuts: { name: string; from: number; to: number }[] = []
    for (const speed of morph.speeds) {
      for (const pass of morph.passes) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one pass after the other, each settled
        const from = await frameCount(page)
        // oxlint-disable-next-line eslint/no-await-in-loop -- one pass after the other, each settled
        await pass.drive(page, speed.ms)
        // oxlint-disable-next-line eslint/no-await-in-loop -- one pass after the other, each settled
        await settled(page)
        // oxlint-disable-next-line eslint/no-await-in-loop -- one pass after the other, each settled
        const to = await frameCount(page)
        cuts.push({ from, name: `${pass.name} (${speed.name})`, to })
      }
    }
    const frames = await recorded(page)
    // Every frame behind the verdict, for a look at what moved where
    mkdirSync(artifactDir, { recursive: true })
    writeFileSync(
      path.join(artifactDir, 'frames.json'),
      JSON.stringify({ cuts, frames })
    )
    // Where it came to rest; WebKit sometimes never finishes a screenshot, and the verdict doesn't need it
    await page
      .screenshot({ path: path.join(artifactDir, 'screen.png'), timeout: 5000 })
      .catch(() => {
        // No screenshot this run
      })
    const counts: Record<Rule, number> = {
      detached: 0,
      frame: 0,
      scale: 0,
      teleport: 0,
    }
    const notes: string[] = []
    const seen = new Set<string>()
    let flights = 0
    let late = 0
    for (const cut of cuts) {
      // From the frame before the pass starts, so its first step is judged
      const j = judge(
        frames.slice(Math.max(cut.from - 1, 0), cut.to),
        morph.parts
      )
      for (const rule of RULES) {
        counts[rule] += j.counts[rule]
      }
      for (const name of j.seen) {
        seen.add(name)
      }
      flights += j.flight ? 1 : 0
      late += j.late
      notes.push(
        `${cut.name}: ${cut.to - cut.from} frames, ${j.flight ? 'flew' : 'no flight'}; teleport ${j.counts.teleport}, scale ${j.counts.scale}, detached ${j.counts.detached}, over ${FRAME_MS}ms of work ${j.counts.frame}, late ${j.late}`,
        ...j.notes.map((line) => `  ${line}`)
      )
    }
    const unseen = morph.parts.filter((p) => !seen.has(p.name))
    if (unseen.length > 0) {
      notes.push(`never shown: ${unseen.map((p) => p.name).join(', ')}`)
    }
    return {
      notes,
      values: {
        detachments: counts.detached,
        droppedFrames: counts.frame,
        flights,
        lateFrames: late,
        missingFlights: Math.max(minFlights - flights, 0),
        scaleReversals: counts.scale,
        teleports: counts.teleport,
        unseenParts: unseen.length,
      },
    }
  } finally {
    await close()
  }
}

/** The motion audit of one morph in one view: every pass at every speed */
export const motionAudit =
  (morph: Morph, surface: Surface, minFlights: number) =>
  async (
    ctx: BenchContext
  ): Promise<{ samples: Sample[]; errors: string[] }> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    // oxlint-disable-next-line promise/avoid-new -- settles when the limit passes
    const stuck = new Promise<{ samples: Sample[]; errors: string[] }>(
      (resolve) => {
        timer = setTimeout(() => {
          resolve({
            errors: [`motion audit stuck for ${LIMIT_MS / 1000}s`],
            samples: [],
          })
        }, LIMIT_MS)
      }
    )
    try {
      return await Promise.race([
        runMotion(morph, surface, ctx.origin, ctx.artifactDir, minFlights).then(
          (sample) => ({ errors: [], samples: [sample] }),
          (error: unknown) => ({
            errors: [
              (error instanceof Error ? error.message : String(error)).split(
                '\n'
              )[0] ?? '',
            ],
            samples: [],
          })
        ),
        stuck,
      ])
    } finally {
      clearTimeout(timer)
    }
  }

const HOME = LAYOUT_PAGES.find((p) => p.name === 'home')
const HOME_SCROLLER = 'section[data-scroll-top]'
const HERO_FIELD = '[data-focus-field]:has(> [data-bench=hero-input])'
const BAR_SLOT = '[data-topbar] [data-dock-slot]'

/**
 * Home's search field flying into the top bar's search as it scrolls under the bar, and home again when it scrolls
 * back (src/components/topbar/search-dock.tsx). The field (then the ghost in flight, then the bar's field or, on a
 * phone, its button) is the morph; its text and the bar's search icon keep to its left edge, the field's action pill
 * to its right end. The ghost is `.search-ghost`; what it draws in flight is found by role: its inputs (the text), the
 * action it carries (`button[type=submit]`) and any other icon
 */
export const HERO_FLIGHT: Morph = {
  name: 'hero-flight',
  parts: [
    {
      name: 'field',
      selector: `${HERO_FIELD}, .search-ghost, ${BAR_SLOT} [data-dock-shell]`,
    },
    {
      name: 'text',
      selector: `[data-bench=hero-input], .search-ghost input, ${BAR_SLOT} input`,
      text: true,
      within: { part: 'field', x: 'start', y: 'centre' },
    },
    {
      name: 'icon',
      selector: `${BAR_SLOT} svg, .search-ghost svg:not(button[type=submit] svg)`,
      within: { part: 'field', x: 'start', y: 'centre' },
    },
    {
      name: 'pill',
      selector: `${HERO_FIELD} button[type=submit], .search-ghost button[type=submit]`,
      within: { drift: 4, part: 'field', x: 'end', y: 'centre' },
    },
  ],
  passes: [
    {
      // Until the field is well past the bar: it docks
      drive: async (page, ms) => {
        const end = await page.evaluate(
          ([scroller, field]) =>
            (document.querySelector(scroller)?.scrollTop ?? 0) +
            (document.querySelector(field)?.getBoundingClientRect().bottom ??
              0) +
            120,
          [HOME_SCROLLER, HERO_FIELD] as const
        )
        await easedScroll(page, HOME_SCROLLER, end, ms)
      },
      name: 'into the bar',
    },
    {
      drive: async (page, ms) => {
        await easedScroll(page, HOME_SCROLLER, 0, ms)
      },
      name: 'home',
    },
  ],
  path: '/',
  ready: async (page) => {
    if (HOME === undefined) {
      throw new Error('no home page in LAYOUT_PAGES')
    }
    await HOME.ready(page)
  },
  scroller: HOME_SCROLLER,
  speeds: [
    { ms: 900, name: 'slow' },
    { ms: 200, name: 'fast' },
  ],
}
