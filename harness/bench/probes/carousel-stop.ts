// Home's Recommendations row after its auto-advance is cut short. The row moves on by one song with the browser's
// smooth scroll; on a phone a finger landing on it stops that scroll where it is, and for a month nothing then
// brought the row onto a slide (2026-11-26: a centred slide 32px off centre in the installed app). Every other
// carousel check reads the row at rest after loading or after stepping it, so none saw a move that never arrived.
//
// In the installed app's view (WebKit) it waits for an advance, stops it once the row has moved 40% of a slide
// (an instant scroll to where it already is, which ends the smooth scroll as a touch does), lets the row rest
// and reads how far the slide nearest the middle is from the middle. Twice.

import { open, PWA_PORTRAIT } from '../engines/browser'
import type { BenchContext, Sample } from '../types'

const LIMIT_MS = 60_000
// The row rests 6 s between advances (use-auto-advance.ts › REST_MS)
const ADVANCE_WAIT_MS = 12_000
// The row is back on a slide about 0.45 s after a stop; read well after
const REST_MS = 1500
const STOPS = 2
// A slide's centre this far from the row's is off centre to the eye
const OFF_PX = 1

interface Stop {
  /** How far from the middle the nearest slide was when the advance was stopped */
  stoppedOffPx: number
  /** The same once the row had rested */
  restedOffPx: number
}

// In the page: waits for the row to move, stops it partway, and reads it after a rest. Null when no advance came
const stopOneAdvance = async ({
  advanceWaitMs,
  restMs,
}: {
  advanceWaitMs: number
  restMs: number
}): Promise<Stop | null> => {
  const track = document.querySelector<HTMLElement>('[data-bench="carousel"]')
  if (track === null) {
    return null
  }
  const offCentre = () => {
    const row = track.getBoundingClientRect()
    const middle = row.left + row.width / 2
    let nearest = Number.POSITIVE_INFINITY
    for (const slide of track.querySelectorAll(
      '[data-bench="carousel-slide"]'
    )) {
      const box = slide.getBoundingClientRect()
      const off = box.left + box.width / 2 - middle
      if (Math.abs(off) < Math.abs(nearest)) {
        nearest = off
      }
    }
    return Math.round(nearest * 10) / 10
  }
  const slide = track.querySelector('[data-bench="carousel-slide"]')
  const pitch = slide === null ? 0 : slide.getBoundingClientRect().width
  const from = track.scrollLeft
  const started = performance.now()
  // oxlint-disable-next-line promise/avoid-new -- settles on the frame the row has moved far enough
  const moved = await new Promise<boolean>((resolve) => {
    const look = () => {
      if (Math.abs(track.scrollLeft - from) > pitch * 0.4) {
        resolve(true)
      } else if (performance.now() - started > advanceWaitMs) {
        resolve(false)
      } else {
        requestAnimationFrame(look)
      }
    }
    look()
  })
  if (!moved) {
    return null
  }
  track.scrollTo({ behavior: 'instant', left: track.scrollLeft })
  const stoppedOffPx = offCentre()
  // oxlint-disable-next-line promise/avoid-new -- turns setTimeout into a promise
  await new Promise<void>((resolve) => {
    setTimeout(resolve, restMs)
  })
  return { restedOffPx: offCentre(), stoppedOffPx }
}

const stops = async (
  origin: string
): Promise<{ samples: Sample[]; errors: string[] }> => {
  const { page, close } = await open(PWA_PORTRAIT.surface)
  try {
    await page.goto(`${origin}/`, { waitUntil: 'load' })
    await page.waitForSelector('[data-bench="carousel-slide"]')
    const seen: Stop[] = []
    for (let index = 0; index < STOPS; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- one advance after another
      const stop = await page.evaluate(stopOneAdvance, {
        advanceWaitMs: ADVANCE_WAIT_MS,
        restMs: REST_MS,
      })
      if (stop === null) {
        return {
          errors: [
            `no sample: the row did not advance within ${ADVANCE_WAIT_MS / 1000}s`,
          ],
          samples: [],
        }
      }
      seen.push(stop)
    }
    const off = seen.filter((stop) => Math.abs(stop.restedOffPx) > OFF_PX)
    return {
      errors: [],
      samples: [
        {
          notes: seen.map(
            (stop, index) =>
              `advance ${index + 1}: stopped ${stop.stoppedOffPx}px off centre, rested ${stop.restedOffPx}px off`
          ),
          values: {
            offMaxPx: Math.max(
              ...seen.map((stop) => Math.abs(stop.restedOffPx))
            ),
            restsOffSlide: off.length,
            stops: seen.length,
          },
        },
      ],
    }
  } finally {
    await close()
  }
}

export const carouselStopAudit =
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
            errors: [`carousel stop audit stuck for ${LIMIT_MS / 1000}s`],
            samples: [],
          })
        }, LIMIT_MS)
      }
    )
    try {
      return await Promise.race([
        stops(ctx.origin).catch((error: unknown) => ({
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
