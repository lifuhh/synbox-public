// The player on a phone on its side looks the same however it got there (Full Screen with the
// rotation lock on and a real landscape full screen must look exactly the same). An iPhone held on its side
// reaches the full-screen player two ways: rotation lock on, Full Screen turns the page by CSS (Lock Landscape's
// turn, page-turn.ts), with the upright screen's safe areas swapped onto the page's sides; rotation lock off, iOS
// turns the screen and reports landscape safe areas. Both are measured in the page's own axes (the turned page's
// boxes mapped back through its transform): the stage, the video, every control shown on the stage and the rail,
// the seek bar, the top bar. Every box must match within 1px, in the default Zoom and in Fit, and the real-landscape
// player reached again from the watch page (Exit Fullscreen, then Full Screen) too. In Fit, and on the watch page on
// its side, the side safe-area bands must be black on screen (read from a screenshot's pixels); Zoom runs the video
// through them. No control may reach into a side or bottom safe area in any of them.

import path from 'node:path'

import type { Page } from 'playwright'

import { open, PWA_LANDSCAPE, PWA_PORTRAIT } from '../engines/browser'
import type { BenchContext, Sample, Surface } from '../types'
import { LAYOUT_PAGES, PLAYER_SONG } from './layout'

const LIMIT_MS = 180_000
/** Boxes this close are the same layout */
const TOLERANCE_PX = 1
/** Only the turned page has these: Flip Screen turns the page the other way, which iOS does itself once it rotates.
 * It hangs under the right-hand column, so nothing else moves for it */
const TURNED_ONLY = new Set(['Flip Screen'])

interface Box {
  x: number
  y: number
  w: number
  h: number
}

interface Measure {
  /** The page's own width and height (the turned page's, not the screen's) */
  size: { w: number; h: number }
  insets: { top: number; right: number; bottom: number; left: number }
  boxes: Record<string, Box>
  /** What paints in the middle of each side band: "video", "no band", or the pixel's rgb */
  bands: { left: string; right: string }
}

/** `on`: the topmost element there, named for the notes */
type BandAt = 'video' | 'no band' | { x: number; y: number; on: string }

/** The screenshot's pixel at each band point, decoded by the page itself (no image library in the bench) */
const bandColours = async (
  page: Page,
  bands: { left: BandAt; right: BandAt },
  png: Buffer
): Promise<{ left: string; right: string }> =>
  await page.evaluate(
    async ({ at, data }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${data}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const g = canvas.getContext('2d')
      if (g === null) {
        throw new Error('no 2D canvas')
      }
      g.drawImage(img, 0, 0)
      const scale = img.naturalWidth / innerWidth
      const read = (b: BandAt) => {
        if (typeof b === 'string') {
          return b
        }
        const [r, gr, bl] = g.getImageData(
          Math.round(b.x * scale),
          Math.round(b.y * scale),
          1,
          1
        ).data
        return `rgb(${r}, ${gr}, ${bl}) on ${b.on}`
      }
      return { left: read(at.left), right: read(at.right) }
    },
    { at: bands, data: png.toString('base64') }
  )

const press = async (page: Page, label: string) => {
  const pressed = await page.evaluate((name) => {
    const button = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${name}"]`
    )
    button?.click()
    return button !== null
  }, label)
  if (!pressed) {
    throw new Error(`no "${label}" button`)
  }
  await page.waitForTimeout(1200)
}

/** The controls show on a tap on the stage, in the screen's axes */
const showControls = async (page: Page) => {
  const centre = await page.evaluate(() => {
    const r = document
      .querySelector('[data-player-stage]')
      ?.getBoundingClientRect()
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
  })
  if (centre === null) {
    throw new Error('no player stage')
  }
  await page.touchscreen.tap(centre.x, centre.y)
  await page.waitForTimeout(600)
}

const measure = async (
  page: Page
): Promise<
  Omit<Measure, 'bands'> & { bands: { left: BandAt; right: BandAt } }
> =>
  await page.evaluate(() => {
    const { body } = document
    const turn = new DOMMatrix(getComputedStyle(body).transform)
    const back = turn.inverse()
    // A screen rect in the page's axes: its corners mapped back through the body's turn
    const toPage = (r: DOMRect) => {
      const corners = [
        back.transformPoint(new DOMPoint(r.left, r.top)),
        back.transformPoint(new DOMPoint(r.right, r.top)),
        back.transformPoint(new DOMPoint(r.left, r.bottom)),
        back.transformPoint(new DOMPoint(r.right, r.bottom)),
      ]
      const xs = corners.map((p) => p.x)
      const ys = corners.map((p) => p.y)
      const x = Math.min(...xs)
      const y = Math.min(...ys)
      return {
        h: Math.round((Math.max(...ys) - y) * 10) / 10,
        w: Math.round((Math.max(...xs) - x) * 10) / 10,
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
      }
    }
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page: nothing outside this function is there
    const shown = (e: Element) => {
      const r = e.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) {
        return false
      }
      let opacity = 1
      for (let n: Element | null = e; n; n = n.parentElement) {
        const cs = getComputedStyle(n)
        if (cs.visibility === 'hidden' || cs.display === 'none') {
          return false
        }
        opacity *= Number(cs.opacity)
      }
      return opacity > 0.5
    }
    // The safe areas as the app reads them, through its own variables
    const probe = document.createElement('div')
    probe.style.cssText =
      'position:absolute;visibility:hidden;padding:var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left)'
    body.append(probe)
    const ps = getComputedStyle(probe)
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page: nothing outside this function is there
    const pixels = (value: string) => Number(value.replace('px', ''))
    const insets = {
      bottom: pixels(ps.paddingBottom),
      left: pixels(ps.paddingLeft),
      right: pixels(ps.paddingRight),
      top: pixels(ps.paddingTop),
    }
    probe.remove()
    const size = { h: body.offsetHeight, w: body.offsetWidth }
    const boxes: Record<string, Box> = {}
    const add = (name: string, e: Element | null) => {
      if (e !== null && shown(e)) {
        let key = name
        for (let i = 2; key in boxes; i += 1) {
          key = `${name} #${i}`
        }
        boxes[key] = toPage(e.getBoundingClientRect())
      }
    }
    const stage = document.querySelector('[data-player-stage]')
    add('stage', stage)
    add('video', document.querySelector('[data-stage-video]'))
    // The YouTube frame itself: youtube-engine places it in its own layer over the stage's video box
    add('youtube frame', document.querySelector('iframe'))
    add('top bar', document.querySelector('[data-topbar]'))
    const rail = document.querySelector('nav[aria-label="Player Controls"]')
    for (const root of [stage, rail?.parentElement ?? null]) {
      for (const b of root?.querySelectorAll('button, [role="slider"]') ?? []) {
        const label =
          b.getAttribute('aria-label') ?? b.getAttribute('role') ?? 'control'
        if (b.getAttribute('role') === 'slider') {
          // The thumb moves with the song; the slider's own box is the layout
          add(label, b.closest('[data-orientation]:not([role])'))
        } else {
          // Playing or paused is the video's state, not the layout's
          add(/^(?:Play|Pause)$/u.test(label) ? 'Play/Pause' : label, b)
        }
      }
    }
    // A band's middle, on the screen: the video when it runs there (Fill), else a point whose pixel is read from a
    // screenshot (a gradient or a layer's colour can't be told from the styles alone)
    const bandAt = (px: number, py: number) => {
      const s = turn.transformPoint(new DOMPoint(px, py))
      const [top] = document.elementsFromPoint(s.x, s.y)
      if (top === undefined) {
        return { on: 'nothing', x: s.x, y: s.y }
      }
      return top.closest('[data-stage-video]') !== null ||
        top.tagName === 'IFRAME'
        ? 'video'
        : {
            on: `${top.tagName.toLowerCase()}.${[...top.classList].slice(0, 3).join('.')}`,
            x: s.x,
            y: s.y,
          }
    }
    const side = Math.max(insets.left, insets.right)
    return {
      bands: {
        left: side > 0 ? bandAt(side / 2, size.h / 2) : 'no band',
        right: side > 0 ? bandAt(size.w - side / 2, size.h / 2) : 'no band',
      },
      boxes,
      insets,
      size,
    }
  })

type Path = 'turned' | 'rotated' | 'rotated-again' | 'side-watch'

/** The full-screen player on a phone on its side, reached one way, in Fit or the default Zoom, controls shown,
 * measured */
const reach = async (
  surface: Surface,
  url: string,
  how: Path,
  shot: string,
  fit = false
): Promise<Measure> => {
  const player = LAYOUT_PAGES.find((p) => p.name === 'player')
  if (player === undefined) {
    throw new Error('no player page in LAYOUT_PAGES')
  }
  const { page, close } = await open(surface)
  try {
    await page.goto(url, { waitUntil: 'commit' })
    await player.ready(page)
    if (how === 'turned') {
      // Rotation lock on: Full Screen from upright turns the page
      await showControls(page)
      await press(page, 'Fullscreen')
    } else if (how === 'rotated-again') {
      // Rotation lock off: the watch page on its side, then Full Screen
      await showControls(page)
      await press(page, 'Exit Fullscreen')
      await press(page, 'Fullscreen')
    } else if (how === 'side-watch') {
      // Rotation lock off: the watch page on its side
      await showControls(page)
      await press(page, 'Exit Fullscreen')
    }
    // A phone on its side fills by default (video-fit.ts); Fit is the whole picture inside the side safe areas
    if (
      fit &&
      (await page.evaluate(
        () =>
          document.querySelector<HTMLElement>('[data-player-stage]')?.dataset
            .fit === 'zoom'
      ))
    ) {
      await showControls(page)
      await press(page, 'Zoom to Fill')
    }
    await showControls(page)
    const m = await measure(page)
    const png = await page.screenshot({ path: shot })
    return { ...m, bands: await bandColours(page, m.bands, png) }
  } finally {
    await close()
  }
}

const diff = (a: Box, b: Box) =>
  Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.w - b.w),
    Math.abs(a.h - b.h)
  )

const fmt = (b: Box) => `${b.x},${b.y} ${b.w}×${b.h}`

/** Every box of `other` against the reference's, and its bands */
const compare = (ref: Measure, other: Measure, label: string): string[] => {
  const out: string[] = []
  const names = new Set([
    ...Object.keys(ref.boxes),
    ...Object.keys(other.boxes),
  ])
  for (const name of names) {
    const a = ref.boxes[name]
    const b = other.boxes[name]
    if (b === undefined && TURNED_ONLY.has(name)) {
      continue
    }
    if (a === undefined || b === undefined) {
      out.push(
        `${label}: ${name} ${a === undefined ? `shows only here (${fmt(b)})` : `missing (turned: ${fmt(a)})`}`
      )
    } else if (diff(a, b) > TOLERANCE_PX) {
      out.push(
        `${label}: ${name} at ${fmt(b)}, turned ${fmt(a)} (off by ${Math.round(diff(a, b) * 10) / 10}px)`
      )
    }
  }
  if (ref.size.w !== other.size.w || ref.size.h !== other.size.h) {
    out.push(
      `${label}: page ${other.size.w}×${other.size.h}, turned ${ref.size.w}×${ref.size.h}`
    )
  }
  return out
}

/** Controls reaching into a side or bottom safe area, where the notch or the home indicator sits */
const insetControls = (m: Measure, label: string): string[] =>
  Object.entries(m.boxes)
    .filter(
      ([name]) => !['stage', 'video', 'youtube frame', 'top bar'].includes(name)
    )
    // Below the fold of a scrolling page is not on the screen yet; scrolled up, it stops above the home indicator
    .filter(([, b]) => b.y < m.size.h)
    .filter(
      ([, b]) =>
        b.x < m.insets.left - TOLERANCE_PX ||
        b.x + b.w > m.size.w - m.insets.right + TOLERANCE_PX ||
        b.y + b.h > m.size.h - m.insets.bottom + TOLERANCE_PX
    )
    .map(([name, b]) => `${label}: ${name} at ${fmt(b)} reaches a safe area`)

/** Black on screen: every channel this dark or darker (the screenshot's encoding can lift a black by a step) */
const BLACK_MAX = 6

const isBlack = (rgb: string) => {
  const channels = /^rgb\((?<r>\d+), (?<g>\d+), (?<b>\d+)\)/u.exec(rgb)?.groups
  return (
    channels !== undefined &&
    Object.values(channels).every((c) => Number(c) <= BLACK_MAX)
  )
}

const bandProblems = (m: Measure, label: string): string[] =>
  (['left', 'right'] as const)
    .filter((s) => m.bands[s] !== 'video' && m.bands[s] !== 'no band')
    .filter((s) => !isBlack(m.bands[s]))
    .map((s) => `${label}: ${s} safe-area band paints ${m.bands[s]}, not black`)

const parity = async (
  origin: string,
  dir: string
): Promise<{ samples: Sample[]; errors: string[] }> => {
  const url = `${origin}/v/${PLAYER_SONG}`
  const turned = await reach(
    PWA_PORTRAIT.surface,
    url,
    'turned',
    path.join(dir, 'turned.png')
  )
  const rotated = await reach(
    PWA_LANDSCAPE.surface,
    url,
    'rotated',
    path.join(dir, 'rotated.png')
  )
  const again = await reach(
    PWA_LANDSCAPE.surface,
    url,
    'rotated-again',
    path.join(dir, 'rotated-again.png')
  )
  const watch = await reach(
    PWA_LANDSCAPE.surface,
    url,
    'side-watch',
    path.join(dir, 'side-watch.png')
  )
  const turnedFit = await reach(
    PWA_PORTRAIT.surface,
    url,
    'turned',
    path.join(dir, 'turned-fit.png'),
    true
  )
  const rotatedFit = await reach(
    PWA_LANDSCAPE.surface,
    url,
    'rotated',
    path.join(dir, 'rotated-fit.png'),
    true
  )
  const runs: [Measure, string][] = [
    [turned, 'turned'],
    [rotated, 'rotated'],
    [again, 'rotated, from the watch page'],
    [watch, 'watch page on its side'],
    [turnedFit, 'turned, Fit'],
    [rotatedFit, 'rotated, Fit'],
  ]
  const diffs = [
    ...compare(turned, rotated, 'rotated'),
    ...compare(turned, again, 'rotated, from the watch page'),
    ...compare(turnedFit, rotatedFit, 'rotated, Fit'),
  ]
  // Zoom runs the video edge to edge, through the bands; Fit and the watch page leave them to black
  const bands = [
    ...bandProblems(watch, 'watch page on its side'),
    ...bandProblems(turnedFit, 'turned, Fit'),
    ...bandProblems(rotatedFit, 'rotated, Fit'),
  ]
  const unsafe = runs.flatMap(([m, label]) => insetControls(m, label))
  const insets = (m: Measure, label: string) =>
    `${label} insets t${m.insets.top} r${m.insets.right} b${m.insets.bottom} l${m.insets.left}, ${Object.keys(m.boxes).length} boxes, bands ${m.bands.left} | ${m.bands.right}`
  return {
    errors: [],
    samples: [
      {
        notes: [
          ...runs.map(([m, label]) => insets(m, label)),
          ...diffs,
          ...bands,
          ...unsafe,
        ],
        values: {
          blackBandsMissing: bands.length,
          boxes: Object.keys(turned.boxes).length,
          insetControls: unsafe.length,
          layoutDiffs: diffs.length,
        },
      },
    ],
  }
}

/** The turned and the rotated full-screen player, measured against each other */
export const landscapeParityAudit =
  () =>
  async (
    ctx: BenchContext
  ): Promise<{ samples: Sample[]; errors: string[] }> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    // oxlint-disable-next-line promise/avoid-new -- settles when the limit passes
    const stuck = new Promise<{ samples: Sample[]; errors: string[] }>(
      (resolve) => {
        timer = setTimeout(() => {
          resolve({
            errors: [`landscape parity audit stuck for ${LIMIT_MS / 1000}s`],
            samples: [],
          })
        }, LIMIT_MS)
      }
    )
    try {
      return await Promise.race([
        parity(ctx.origin, ctx.artifactDir).catch((error: unknown) => ({
          errors: [
            (error instanceof Error ? error.message : String(error)).split(
              '\n'
            )[0],
          ],
          samples: [],
        })),
        stuck,
      ])
    } finally {
      clearTimeout(timer)
    }
  }
