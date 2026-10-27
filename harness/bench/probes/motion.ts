// A motion audit for any morph, where one element turns into another (home's search field flying into the top bar's
// search and back). It drives the real transition, records every part's box and opacity on every rendered frame, and
// judges the frames against these rules:
//
// - teleport: nothing jumps between frames. An element's opacity changes by at most POP_STEP a frame (one not there
//   counts as 0), unless another element of the same part takes over in the same place, within HANDOVER_PX (the real
//   field handing over to its copy in flight), or it is off screen in the other frame; a part attached to another
//   moves with it, its anchored edge shifting no more than STEP_PX against the container's in one frame; a free
//   part's edge never steps more than the page's own scroll plus FREE_STEP_PX. POP_STEP, STEP_PX and FREE_STEP_PX are
//   per 60Hz frame: a frame that came late may move that much for each frame it took (a stalled headless frame is a
//   late frame, not a jump).
// - scale: in a morph that grows nothing shrinks, and in one that shrinks nothing grows: every element's width and
//   height move the morph's way only (beyond NOISE_PX); in a part that keeps its size, they never turn back.
// - detached: an attached part stays inside its container's box (within NOISE_PX), and drifts from its anchor no
//   more than its own `drift` on any frame (on each axis it names), from where it first showed against its
//   anchor, scaled with the container: a pill keeps its centre on its field's centre line and its gap to the field's
//   end, every frame, never a path of its own.
// - frame: from the morph's first hand-over to its last, no frame takes the page over DROP_MS of main-thread work
//   (from the frame's start to its layout): two frames' budget, so it drops at least one whatever else runs. Frames
//   over FRAME_MS (`slow`) and gaps between frames over FRAME_MS (`late`) are reported, not judged: alone, a desktop
//   flight's frames take under 15ms, but with three audits at once (as `check` runs them) the page's own work during
//   the scroll put one frame in nine runs at 26ms; and a headless frame clock is uneven (8% of idle frames on desktop
//   Chromium came over 25ms). Frames before and after the morph, the page scrolling, are the page's, not the morph's.
// - stall: a frame that came over `stallMs` after the one before (STALL_MS, or STALL_FACTOR times the pass's median
//   frame if that is longer) is the machine stalling, not the page: what moved across it, or across the frame after it
//   (where what the page did during the stall is drawn), is not judged as a teleport.
//   A pass where such a gap hid a jump is run again (REDOS times at most) and the first attempt with none is judged;
//   if every attempt stalled, the audit has no sample (`machine stalled`), which `check` retries like any audit that
//   measured nothing. A jump between frames a normal interval apart is judged as ever. Gaps over `stallMs`, and
//   passes run again, are reported (`stalledFrames`, `redos`), not judged.
//
// - overshoot, slant, settle: the flight's own shape (`judgeShape`): no edge passes its landing and comes back, the
//   box's edges share one progress, and no tail creeps the last pixels in.
//
// Thresholds, from the hero flight measured frame by frame (2026-10-27, desktop Chromium and iPhone WebKit): a 260ms
// ease-out across ~330px moves a box ~41px in its first frame (a 0.45 s spring ~30px), so FREE_STEP_PX (60, on top
// of the scroll) passes any such curve and catches a jump; a part riding its container's edge moves under 2px a frame
// against it, so STEP_PX is 3; HANDOVER_PX is the 0.5px a hand-off from a moving copy to the real element may miss
// by; POP_STEP 0.5 is a fade of fewer than two frames. A box whose edges share one progress measures under 0.005 apart
// (a box sliding with a bar 0.04-0.06), so SLANT_SPREAD is 0.03; a spring crept within 2px of its landing for 14-24
// frames, a 260ms ease-out for 3, so SETTLE_FRAMES is 4.
//
// STALL_MS, from 304 recorded passes (2026-10-27, every view): frames where something moved came 16.8ms apart at the
// median, 34ms at the 99th percentile (two refreshes), and a stall on a loaded machine left 105-4000ms gaps; 50 (three
// refreshes) sits above the clock's own jitter. STALL_FACTOR 3 keeps a page whose clock runs slow throughout (a 33ms
// median) from reading every frame as a stall. A redo costs one more run of the speed's passes (~2-5 s); a gap that
// hid nothing costs none.

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
const FREE_STEP_PX = 60
const OVERSHOOT_PX = 0.5
const SLANT_SPREAD = 0.03
const SLANT_MIN_PX = 4
const SETTLE_PX = 2
const SETTLE_FRAMES = 4
const NOISE_PX = 1
const FRAME_MS = 25
const DROP_MS = 34
const VSYNC_MS = 1000 / 60
const STALL_MS = 50
const STALL_FACTOR = 3
/** Times each speed's passes run again while a stall hid a jump in one of them */
export const REDOS = 2
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
   * The part it belongs to and moves with: the edge it keeps to on each axis, and on each axis given in `drift`, how
   * far it may stray, on any frame, from where it first showed against that edge, scaled with the container
   */
  within?: {
    part: string
    x: Edge
    y: Edge
    drift?: { x?: number; y?: number }
  }
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
  /** Area left on screen once its clipping ancestors and the viewport cut it, however faint */
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
    ({ list, scrollerSelector }) => {
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
                a: round(shownArea(el, box)),
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

/** Frames `from` to `to` so far, the recorder still running */
const framesBetween = async (
  page: Page,
  from: number,
  to: number
): Promise<Frame[]> =>
  await page.evaluate(
    ([a, b]) => {
      const found: unknown = Reflect.get(globalThis, '__motion')
      return typeof found === 'object' &&
        found !== null &&
        'frames' in found &&
        Array.isArray(found.frames)
        ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the recorder's own frames, installed by startRecording
          (found.frames.slice(a, b) as Frame[])
        : []
    },
    [from, to] as const
  )

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

/**
 * Scrolls `scroller` to `to` over `ms`, eased in and out as a flick is, one step per frame. Each step lands between
 * frames, as a wheel or a finger's scroll does: the frame starts with the new offset, its scroll events, then its
 * animation callbacks. A step taken inside an animation callback landed after the page's own callbacks had read the
 * layout in some frames, so a box following the scroll trailed it by a step and caught up in one jump
 */
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
        const step = () => {
          const k = Math.min((performance.now() - start) / duration, 1)
          const eased = k * k * (3 - 2 * k)
          box.scrollTo({
            behavior: 'instant',
            top: from + (target - from) * eased,
          })
          if (k < 1) {
            // Once this frame is painted, before the next one begins
            requestAnimationFrame(() => {
              setTimeout(step, 0)
            })
          } else {
            resolve()
          }
        }
        requestAnimationFrame(() => {
          setTimeout(step, 0)
        })
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

export type Rule =
  | 'teleport'
  | 'scale'
  | 'detached'
  | 'frame'
  | 'overshoot'
  | 'slant'
  | 'settle'

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

/** Two boxes the same within a hand-over's tolerance */
const meets = (a: Shown, b: Shown) => sameBox(a, b, HANDOVER_PX)

/** How far a part jumped, from where it showed to where it showed next */
const jumpText = (from: Shown, to: Shown) => {
  const dx = to.l - from.l
  const dy = to.t - from.t
  return ` (a jump of ${Math.abs(dx).toFixed(1)}px ${WAYS.x[dx < 0 ? 0 : 1]}, ${Math.abs(dy).toFixed(1)}px ${WAYS.y[dy < 0 ? 0 : 1]})`
}

/** Whether two elements of a part sat in the same place in some frame they both had: this one or the one before */
const together = (
  a: { was?: Shown; now?: Shown },
  b: { was?: Shown; now?: Shown }
) =>
  (a.was !== undefined && b.was !== undefined && meets(a.was, b.was)) ||
  (a.now !== undefined && b.now !== undefined && meets(a.now, b.now)) ||
  (a.was !== undefined && b.now !== undefined && meets(a.was, b.now)) ||
  (a.now !== undefined && b.was !== undefined && meets(a.now, b.was))

/**
 * A show or hide at once is fine when it hands over: the element and another of its part sat in the same place in
 * the frame before or this one (a ghost lands on a field the page is still moving: they matched the frame before,
 * and the field shows where the page has taken it); or when it was off screen in the other frame
 */
const excused = (
  appearing: boolean,
  self: { was?: Shown; now?: Shown },
  others: { was?: Shown; now?: Shown }[]
) => {
  const offScreen = appearing
    ? self.was !== undefined && self.was.a < 1
    : self.now !== undefined && self.now.a < 1
  return offScreen || others.some((o) => together(self, o))
}

/** Showing and hiding go by a ramp of opacity, unless `excused` */
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
    const at = appearing ? after : before
    if (
      at !== undefined &&
      Math.abs(to - from) > POP_STEP * span &&
      !excused(
        appearing,
        { now: after, was: before },
        others.map((q) => ({
          now: nowOf(q.id),
          was: was.find((w) => w.id === q.id),
        }))
      )
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
const judgeAttached = (
  p: MorphPart,
  { n, prev, cur, span }: Step,
  flag: Flag
) => {
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
      if (Math.abs(step) > STEP_PX * span) {
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
  const { part } = p.within
  // Where the part first showed against its container's edges, and the container's height then: from there its
  // offsets scale with the container (a gap of 5px in a 50px field is 4px in a 40px one)
  let first: { x: number; y: number; h: number } | null = null
  for (const [n, f] of frames.entries()) {
    const c = primary(f, part)
    if (c === null) {
      continue
    }
    for (const e of shownOf(f, p.name)) {
      const h = c.b - c.t
      first ??= {
        h,
        x: along(e, c, 'x', p.within.x),
        y: along(e, c, 'y', p.within.y),
      }
      for (const axis of ['x', 'y'] as const) {
        const allowed = drift[axis]
        const off =
          along(e, c, axis, p.within[axis]) - (first[axis] * h) / first.h
        if (allowed !== undefined && Math.abs(off) > allowed) {
          flag(
            'detached',
            p.name,
            n,
            `${Math.abs(off).toFixed(1)}px ${WAYS[axis][off < 0 ? 0 : 1]} of where it keeps against ${part}'s ${EDGE_NAMES[axis][p.within[axis]]} (allowed ${allowed}px)`
          )
        }
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

const EDGES = ['l', 'r', 't', 'b'] as const
interface Flying {
  n: number
  f: Frame
  g: Shown
}

/** The frames the morph is drawn in flight (by neither the element it started as nor the one it lands as) */
const flightFrames = (frames: Frame[], root: string) => {
  const ids = frames.map((f) => primary(f, root)?.id ?? null)
  const from = ids.find((id) => id !== null)
  const to = ids.findLast((id) => id !== null)
  const flying: Flying[] = frames.flatMap((f, n) => {
    const g = primary(f, root)
    return g !== null && g.id !== from && g.id !== to ? [{ f, g, n }] : []
  })
  return { flying, to }
}

/** Each edge's share of the way, from where the flight's box first showed to its destination now */
const sharesOf = (g: Shown, start: Shown, dest: Shown) =>
  EDGES.flatMap((k) => {
    const way = dest[k] - start[k]
    return Math.abs(way) >= SLANT_MIN_PX
      ? [{ k, share: (g[k] - start[k]) / way }]
      : []
  })

/** Slant and settle of the morph's own box (see `judgeShape`) */
const judgeBox = (frames: Frame[], root: string, flag: Flag) => {
  const { flying, to } = flightFrames(frames, root)
  const start = flying[0]?.g
  let close = 0
  for (const { f, g, n } of start === undefined ? [] : flying) {
    const dest = (f.parts[root] ?? []).find((e) => e.id === to)
    if (dest !== undefined) {
      const shares = sharesOf(g, start ?? g, dest)
      const values = shares.map((s) => s.share)
      const spread =
        values.length > 1 ? Math.max(...values) - Math.min(...values) : 0
      if (spread > SLANT_SPREAD) {
        flag(
          'slant',
          root,
          n,
          `its edges are ${shares.map((s) => `${s.k} ${(s.share * 100).toFixed(0)}%`).join(', ')} of the way: ${(spread * 100).toFixed(1)} points apart (allowed ${SLANT_SPREAD * 100})`
        )
      }
      const off = Math.max(...EDGES.map((k) => Math.abs(g[k] - dest[k])))
      // Creeping: close but not yet on it (the frame drawn exactly on its landing is the landing)
      close = off <= SETTLE_PX && off > 0.1 ? close + 1 : 0
    }
  }
  if (close > SETTLE_FRAMES) {
    flag(
      'settle',
      root,
      flying.at(-1)?.n ?? 0,
      `crept within ${SETTLE_PX}px of where it lands for ${close} frames before landing (allowed ${SETTLE_FRAMES})`
    )
  }
  return new Set(flying.map((x) => x.n))
}

const edgeName = (k: (typeof EDGES)[number]) =>
  EDGE_NAMES[k === 'l' || k === 'r' ? 'x' : 'y'][
    k === 'l' || k === 't' ? 'start' : 'end'
  ]

/** One part's edges in flight against the same edges of the element that draws it after the pass, frame by frame */
const judgeOvershoot = (
  frames: Frame[],
  p: MorphPart,
  window: Set<number>,
  flag: Flag
) => {
  const end = frames.findLast((f) => shownOf(f, p.name).length > 0)
  const destId = end === undefined ? undefined : primary(end, p.name)?.id
  const sides = new Map<string, number>()
  for (const [n, f] of frames.entries()) {
    const dest = (f.parts[p.name] ?? []).find((e) => e.id === destId)
    const flying = shownOf(f, p.name).filter((q) => q.id !== destId)
    for (const e of window.has(n) && dest !== undefined ? flying : []) {
      for (const k of EDGES) {
        const d = e[k] - (dest?.[k] ?? e[k])
        const key = `${e.id} ${k}`
        const side = sides.get(key)
        if (Math.abs(d) > OVERSHOOT_PX && side === undefined) {
          sides.set(key, Math.sign(d))
        } else if (
          Math.abs(d) > OVERSHOOT_PX &&
          Math.sign(d) === -(side ?? 0)
        ) {
          flag(
            'overshoot',
            p.name,
            n,
            `its ${edgeName(k)} went ${Math.abs(d).toFixed(1)}px past where it lands (allowed ${OVERSHOOT_PX}px)`
          )
          sides.set(key, Math.sign(d))
        }
      }
    }
  }
}

/**
 * The flight's own shape, from the first frame the morph is drawn by something other than where it started to the
 * last before it lands. Every part is measured against its destination (the element that draws it once the pass is
 * over, read in the same frame even while hidden, so a destination that moves with the page counts where it is):
 * - overshoot: an edge never passes its destination's edge and comes back (beyond OVERSHOOT_PX);
 * - slant: the morph's edges (left, right, top, bottom) cover the same share of the way, from where the flight's box
 *   first showed to its destination, in every frame (within SLANT_SPREAD): one progress, never an edge leading;
 * - settle: the flight lands within SETTLE_FRAMES frames of coming within SETTLE_PX of its destination: no tail
 *   creeping the last pixels in
 */
const judgeShape = (frames: Frame[], parts: MorphPart[], flag: Flag) => {
  const [root] = parts
  if (root === undefined) {
    return
  }
  const window = judgeBox(frames, root.name, flag)
  for (const p of parts) {
    judgeOvershoot(frames, p, window, flag)
  }
}

/** The gap between two frames past which the machine stalled: STALL_MS, or STALL_FACTOR times the median frame */
export const stallLimit = (times: number[]): number => {
  const gaps = times
    .slice(1)
    .map((t, i) => t - (times[i] ?? t))
    .toSorted((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)] ?? VSYNC_MS
  return Math.max(STALL_MS, STALL_FACTOR * median)
}

/** Jumps a stalled frame hid: not judged, the pass is run again */
export interface Stall {
  /** The longest gap that hid one, and the frame after it */
  gapMs: number
  frame: number
  hidden: number
  limitMs: number
}

export const stallText = (s: Stall): string =>
  `a ${s.gapMs.toFixed(0)}ms frame gap at frame ${s.frame} (over ${s.limitMs.toFixed(0)}ms) hid ${s.hidden} jump${s.hidden === 1 ? '' : 's'}`

export interface Judged {
  counts: Record<Rule, number>
  /** Jumps across stalled frames, not judged; null when none hid one */
  stall: Stall | null
  /** Frames over the stall limit after the one before, whatever they hid */
  stalledFrames: number
  /** Frames over FRAME_MS after the one before, in the morph: reported, not judged (see the top of this file) */
  late: number
  /** Frames in the morph with over FRAME_MS of main-thread work: reported; over DROP_MS they count as dropped */
  slow: number
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
    overshoot: 0,
    scale: 0,
    settle: 0,
    slant: 0,
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
  let slow = 0
  const hidden: { frame: number; gapMs: number }[] = []
  let stalledFrames = 0
  const limitMs = stallLimit(frames.map((f) => f.t))
  const [root] = parts
  // Frames are judged from the morph's first hand-over to its last (the field to the ghost, the ghost to the bar):
  // the page scrolling before and after is the page's own business
  const ids = frames.map((f) =>
    root === undefined ? null : (primary(f, root.name)?.id ?? null)
  )
  const turns = ids.flatMap((id, n) => (n > 0 && id !== ids[n - 1] ? [n] : []))
  const [first] = turns
  const last = turns.at(-1)
  for (const s of steps(frames)) {
    if (
      first !== undefined &&
      last !== undefined &&
      s.n >= first &&
      s.n <= last
    ) {
      if (s.cur.work > DROP_MS) {
        flag(
          'frame',
          'page',
          s.n,
          `${s.cur.work.toFixed(1)}ms of main-thread work in one frame of the morph`
        )
      }
      slow += s.cur.work > FRAME_MS ? 1 : 0
      late += s.cur.t - s.prev.t > FRAME_MS ? 1 : 0
    }
    const ownGap = s.cur.t - s.prev.t
    stalledFrames += ownGap > limitMs ? 1 : 0
    // The frame after a stalled one too: what the page did during the stall (a scroll step timed by the clock) is
    // drawn there, a few ms after the late frame (seen: 153ms late, then 2ms, the scroll 125px on)
    const gapMs = Math.max(ownGap, s.prev.t - (frames[s.n - 2]?.t ?? s.prev.t))
    // Across a stalled frame a jump is the machine's: kept aside, never counted
    const stepFlag: Flag =
      gapMs > limitMs
        ? (rule, part, frame, text) => {
            if (rule === 'teleport') {
              hidden.push({ frame, gapMs })
            } else {
              flag(rule, part, frame, text)
            }
          }
        : flag
    for (const p of parts) {
      judgePops(p, s, stepFlag)
      if (p.within === undefined) {
        judgeFreeSteps(p, s, stepFlag)
      } else {
        judgeAttached(p, s, stepFlag)
      }
    }
  }
  for (const p of parts) {
    judgeDrift(frames, p, flag)
  }
  judgeScale(frames, parts, flag)
  judgeShape(frames, parts, flag)
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
  const [longest] = hidden.toSorted((a, b) => b.gapMs - a.gapMs)
  return {
    counts,
    flight: rootIds.size > 1,
    late,
    notes,
    seen,
    slow,
    stall:
      longest === undefined
        ? null
        : { ...longest, hidden: hidden.length, limitMs },
    stalledFrames,
  }
}

const RULES: Rule[] = [
  'teleport',
  'scale',
  'detached',
  'frame',
  'overshoot',
  'slant',
  'settle',
]

/**
 * Every pass at every speed, judged as it ends. A speed's passes all run again, in order (so each starts where it did
 * the first time), while a stall hid a jump in one of them, REDOS times at most. `cuts` is every pass run; `kept` the
 * one judged per pass: its first attempt where no stall hid a jump
 */
const runPasses = async (page: Page, morph: Morph) => {
  const cuts: {
    name: string
    attempt: number
    from: number
    to: number
    stalled?: string
  }[] = []
  const kept = new Map<string, { attempt: number; j: Judged }>()
  const stalls = new Map<string, Stall>()
  let stalledFrames = 0
  let redos = 0
  for (const speed of morph.speeds) {
    const names = morph.passes.map((p) => `${p.name} (${speed.name})`)
    for (
      let attempt = 0;
      attempt <= REDOS && names.some((n) => !kept.has(n));
      attempt += 1
    ) {
      redos += attempt > 0 ? 1 : 0
      for (const [i, pass] of morph.passes.entries()) {
        const name = names[i] ?? pass.name
        // oxlint-disable-next-line eslint/no-await-in-loop -- one pass after the other, each settled
        const from = await frameCount(page)
        // oxlint-disable-next-line eslint/no-await-in-loop -- one pass after the other, each settled
        await pass.drive(page, speed.ms)
        // oxlint-disable-next-line eslint/no-await-in-loop -- one pass after the other, each settled
        await settled(page)
        // oxlint-disable-next-line eslint/no-await-in-loop -- one pass after the other, each settled
        const to = await frameCount(page)
        // From the frame before the pass starts, so its first step is judged
        const j = judge(
          // oxlint-disable-next-line eslint/no-await-in-loop -- judged before the next pass decides on a redo
          await framesBetween(page, Math.max(from - 1, 0), to),
          morph.parts
        )
        stalledFrames += j.stalledFrames
        cuts.push({
          attempt,
          from,
          name,
          to,
          ...(j.stall === null ? {} : { stalled: stallText(j.stall) }),
        })
        if (j.stall !== null) {
          stalls.set(name, j.stall)
        } else if (!kept.has(name)) {
          kept.set(name, { attempt, j })
        }
      }
    }
  }
  return { cuts, kept, redos, stalledFrames, stalls }
}

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
    const { cuts, kept, redos, stalledFrames, stalls } = await runPasses(
      page,
      morph
    )
    const frames = await recorded(page)
    // Every frame behind the verdict, for a look at what moved where
    mkdirSync(artifactDir, { recursive: true })
    writeFileSync(
      path.join(artifactDir, 'frames.json'),
      JSON.stringify({ cuts, frames })
    )
    const unjudged = cuts.filter((c) => !kept.has(c.name))
    if (unjudged.length > 0) {
      const [first] = unjudged
      const stall = first === undefined ? undefined : stalls.get(first.name)
      throw new Error(
        `machine stalled: ${first?.name ?? 'a pass'} stalled on all ${REDOS + 1} attempts (last: ${stall === undefined ? 'unknown' : stallText(stall)})`
      )
    }
    // Where it came to rest; WebKit sometimes never finishes a screenshot, and the verdict doesn't need it
    await page
      .screenshot({ path: path.join(artifactDir, 'screen.png'), timeout: 5000 })
      .catch(() => {
        // No screenshot this run
      })
    const counts: Record<Rule, number> = {
      detached: 0,
      frame: 0,
      overshoot: 0,
      scale: 0,
      settle: 0,
      slant: 0,
      teleport: 0,
    }
    const notes: string[] = []
    const seen = new Set<string>()
    let flights = 0
    let late = 0
    let slow = 0
    for (const cut of cuts) {
      if (cut.stalled !== undefined) {
        notes.push(
          `${cut.name}, attempt ${cut.attempt + 1}: run again: ${cut.stalled}`
        )
      }
      const keep = kept.get(cut.name)
      if (keep === undefined || keep.attempt !== cut.attempt) {
        continue
      }
      const { j } = keep
      for (const rule of RULES) {
        counts[rule] += j.counts[rule]
      }
      for (const name of j.seen) {
        seen.add(name)
      }
      flights += j.flight ? 1 : 0
      late += j.late
      slow += j.slow
      notes.push(
        `${cut.name}${cut.attempt > 0 ? `, attempt ${cut.attempt + 1}` : ''}: ${cut.to - cut.from} frames, ${j.flight ? 'flew' : 'no flight'}; teleport ${j.counts.teleport}, scale ${j.counts.scale}, detached ${j.counts.detached}, overshoot ${j.counts.overshoot}, slant ${j.counts.slant}, settle ${j.counts.settle}, over ${FRAME_MS}ms of work ${j.slow} (over ${DROP_MS}ms ${j.counts.frame}), late ${j.late}`,
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
        overshoots: counts.overshoot,
        redos,
        scaleReversals: counts.scale,
        settles: counts.settle,
        slants: counts.slant,
        slowFrames: slow,
        stalledFrames,
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
      within: { drift: { y: 1 }, part: 'field', x: 'start', y: 'centre' },
    },
    {
      name: 'icon',
      selector: `${BAR_SLOT} svg, .search-ghost svg:not(button[type=submit] svg)`,
      within: { drift: { y: 1 }, part: 'field', x: 'start', y: 'centre' },
    },
    {
      name: 'pill',
      selector: `${HERO_FIELD} button[type=submit], .search-ghost button[type=submit]`,
      within: { drift: { x: 1, y: 1 }, part: 'field', x: 'end', y: 'centre' },
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
