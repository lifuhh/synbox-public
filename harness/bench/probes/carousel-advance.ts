// Home's Recommendations row moving on by itself, every frame. One advance must be one motion: it starts, moves one
// slide in one direction and stops centred, with no pause and no second move after it. In November 2026 the advance
// used the browser's smooth scroll, which WebKit stopped about 48px short; the rest came as a second motion (a snap,
// then a corrective scroll). The audit before this one read only where the row came to rest, so it passed every
// split advance (2026-11-28-fix-carousel-one-motion).
//
// In the installed app's view (WebKit) it records advances after the page loads, then leaves Home and comes back
// (the row remounts) and records more: the owner's report was "past first load".

import type { Page } from 'playwright'

import { open, PWA_PORTRAIT } from '../engines/browser'
import type { BenchContext, Sample } from '../types'

const LIMIT_MS = 90_000
// The row rests 6 s between advances (use-auto-advance.ts › REST_MS)
const ADVANCE_WAIT_MS = 12_000
// An advance is over once the row has not moved for this long
const DONE_STILL_MS = 600
// The old smooth-scroll advance split about 1 in 3 in this view (2026-11-28: 4 of 12): six advances catch that
// about 9 runs in 10
const ADVANCES_PER_VISIT = 3
// Frames in a row without movement that split a motion in two: about 50ms at 60Hz
const SPLIT_FRAMES = 3
// Movement below this between two frames is no movement
const MOVE_PX = 0.25
// A slide's centre this far from the row's is off centre to the eye
const OFF_PX = 1

interface Frame {
  t: number
  x: number
  /** Nearest slide's centre minus the row's, in layout pixels */
  off: number
}

interface Advance {
  motions: number
  reversals: number
  /** How far the row moved, against one slide's pitch */
  travelPx: number
  pitchPx: number
  restOffPx: number
}

// In the page: waits for the row to move, then records every frame until it has been still for doneStillMs. Null
// when no advance came
const recordAdvance = async ({
  advanceWaitMs,
  doneStillMs,
  movePx,
}: {
  advanceWaitMs: number
  doneStillMs: number
  movePx: number
}): Promise<{ frames: Frame[]; pitch: number } | null> => {
  const track = document.querySelector<HTMLElement>('[data-bench="carousel"]')
  if (track === null) {
    return null
  }
  const slides = track.querySelectorAll<HTMLElement>(
    '[data-bench="carousel-slide"]'
  )
  const pitch =
    slides.length > 1 ? slides[1].offsetLeft - slides[0].offsetLeft : 0
  const sample = (t: number): Frame => {
    const middle = track.scrollLeft + track.clientWidth / 2
    let off = Number.POSITIVE_INFINITY
    for (const slide of slides) {
      const centre = slide.offsetLeft + slide.offsetWidth / 2 - middle
      if (Math.abs(centre) < Math.abs(off)) {
        off = centre
      }
    }
    return { off, t, x: track.scrollLeft }
  }
  const from = track.scrollLeft
  const started = performance.now()
  // oxlint-disable-next-line promise/avoid-new -- settles on frames: the first move, then the rest after it
  return await new Promise((resolve) => {
    const frames: Frame[] = []
    let lastMove = 0
    const tick = (t: number) => {
      const frame = sample(t)
      if (frames.length === 0) {
        if (Math.abs(frame.x - from) <= movePx) {
          if (t - started > advanceWaitMs) {
            resolve(null)
            return
          }
          requestAnimationFrame(tick)
          return
        }
        frames.push({ ...sample(t), x: from })
      }
      const previous = frames.at(-1)
      if (previous !== undefined && Math.abs(frame.x - previous.x) > movePx) {
        lastMove = t
      }
      frames.push(frame)
      if (t - lastMove > doneStillMs) {
        resolve({ frames, pitch })
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

// Motions are runs of moving frames, split by SPLIT_FRAMES still ones; a reversal is a frame moving against the one
// before it
const judge = (frames: Frame[], pitch: number): Advance => {
  let motions = 0
  let still = SPLIT_FRAMES
  let reversals = 0
  let lastStep = 0
  for (let index = 1; index < frames.length; index += 1) {
    const step = frames[index].x - frames[index - 1].x
    if (Math.abs(step) > MOVE_PX) {
      if (still >= SPLIT_FRAMES) {
        motions += 1
      }
      if (lastStep !== 0 && Math.sign(step) !== Math.sign(lastStep)) {
        reversals += 1
      }
      lastStep = step
      still = 0
    } else {
      still += 1
    }
  }
  const [first] = frames
  const last = frames.at(-1) ?? first
  return {
    motions,
    pitchPx: pitch,
    restOffPx: Math.round(last.off * 10) / 10,
    reversals,
    travelPx: Math.round(Math.abs(last.x - first.x) * 10) / 10,
  }
}

// ADVANCES_PER_VISIT advances one after another, or why there was no sample
const recordVisit = async (
  page: Page,
  visit: string
): Promise<{ visit: string; advance: Advance }[] | string> => {
  const seen: { visit: string; advance: Advance }[] = []
  for (let index = 0; index < ADVANCES_PER_VISIT; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one advance after another
    const recorded = await page.evaluate(recordAdvance, {
      advanceWaitMs: ADVANCE_WAIT_MS,
      doneStillMs: DONE_STILL_MS,
      movePx: MOVE_PX,
    })
    if (recorded === null) {
      return `no sample: the row did not advance within ${ADVANCE_WAIT_MS / 1000}s (${visit})`
    }
    seen.push({ advance: judge(recorded.frames, recorded.pitch), visit })
  }
  return seen
}

const advances = async (
  origin: string
): Promise<{ samples: Sample[]; errors: string[] }> => {
  const { page, close } = await open(PWA_PORTRAIT.surface)
  try {
    await page.goto(`${origin}/`, { waitUntil: 'load' })
    await page.waitForSelector('[data-bench="carousel-slide"]')
    const afterLoad = await recordVisit(page, 'after load')
    if (typeof afterLoad === 'string') {
      return { errors: [afterLoad], samples: [] }
    }
    // Away to another page in the app and back: the row remounts
    await page.evaluate(() => {
      history.pushState(null, '', '/about')
      dispatchEvent(new PopStateEvent('popstate'))
    })
    await page.waitForSelector('[data-bench="carousel"]', { state: 'detached' })
    await page.goBack()
    await page.waitForSelector('[data-bench="carousel-slide"]')
    const afterBack = await recordVisit(page, 'after coming back')
    if (typeof afterBack === 'string') {
      return { errors: [afterBack], samples: [] }
    }
    const seen = [...afterLoad, ...afterBack]
    const all = seen.map(({ advance }) => advance)
    return {
      errors: [],
      samples: [
        {
          notes: seen.map(
            ({ visit, advance }, index) =>
              `advance ${index + 1} (${visit}): ${advance.motions} motion(s), ${advance.reversals} reversal(s), moved ${advance.travelPx}px of a ${advance.pitchPx}px slide, rests ${advance.restOffPx}px off centre`
          ),
          values: {
            advances: all.length,
            offMaxPx: Math.max(...all.map((a) => Math.abs(a.restOffPx))),
            restsOffSlide: all.filter((a) => Math.abs(a.restOffPx) > OFF_PX)
              .length,
            reversals: all.reduce((sum, a) => sum + a.reversals, 0),
            splitAdvances: all.filter((a) => a.motions !== 1).length,
            wrongTravel: all.filter(
              (a) => Math.abs(a.travelPx - a.pitchPx) > OFF_PX
            ).length,
          },
        },
      ],
    }
  } finally {
    await close()
  }
}

export const carouselAdvanceAudit =
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
            errors: [`carousel advance audit stuck for ${LIMIT_MS / 1000}s`],
            samples: [],
          })
        }, LIMIT_MS)
      }
    )
    try {
      return await Promise.race([
        advances(ctx.origin).catch((error: unknown) => ({
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
