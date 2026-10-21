// The home page as one visit: load, first input, the recommendations row, the YouTube charts, the gallery, then
// one press of Next and a fast scroll through the gallery. One page load buys every metric below.

import type { Page } from 'playwright'

import { mark, open } from '../engines/browser'
import type { FrameStats } from '../engines/recorder'
import type { BenchContext, Sample } from '../types'
import { repeat, settledNumber } from './common'

/** Time from a click on Next until the row stops scrolling, with the frames painted meanwhile */
const carouselNext = async (
  page: Page
): Promise<{ ms: number; frames: FrameStats }> => {
  await page.evaluate(() => {
    const track = document.querySelector(
      'section[aria-label=Recommendations] .carousel-track'
    )
    // oxlint-disable-next-line promise/avoid-new -- turns the scrollend event and a timeout into one promise
    window.__benchScrollEnd = new Promise<number>((resolve) => {
      track?.addEventListener(
        'scrollend',
        () => {
          resolve(performance.now())
        },
        { once: true }
      )
      setTimeout(() => {
        resolve(-1)
      }, 5000)
    })
    window.__bench.frames.start()
  })
  await page.click('button[aria-label="Next Recommendation"]')
  return await page.evaluate(async () => {
    const end = await window.__benchScrollEnd
    const frames = window.__bench.frames.stop()
    if (end < 0) {
      throw new Error(
        'the recommendations row never finished scrolling after Next'
      )
    }
    return { frames, ms: end - (window.__bench.marks.input ?? end) }
  })
}

/**
 * Scrolls the page's scroller from the gallery title down at a steady 3000px/s for 3s, driven by script once per
 * frame (as fast as a flick), and samples how many tiles in view still show no image (blank while virtualising).
 */
const galleryScroll = async (
  page: Page
): Promise<FrameStats & { blankRatio: number; tiles: number }> =>
  await page.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>(
      'section[data-scroll-top]'
    )
    const title = document.querySelector('#gallery-title')
    if (!scroller || !title) {
      throw new Error('no page scroller or gallery title')
    }
    title.scrollIntoView({ block: 'start' })
    // oxlint-disable-next-line promise/avoid-new -- turns setTimeout into a promise
    await new Promise((resolve) => {
      setTimeout(resolve, 300)
    })
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- page.evaluate serialises this callback, so it can't reach module scope
    const tiles = () => [
      ...document.querySelectorAll(
        'section[aria-labelledby=gallery-title] ul > li'
      ),
    ]
    let blank = 0
    let seen = 0
    window.__bench.frames.start()
    const start = performance.now()
    let lastSample = start
    let prev: number | null = null
    // oxlint-disable-next-line promise/avoid-new -- turns the requestAnimationFrame loop into a promise
    await new Promise<void>((resolve) => {
      const step = (t: number) => {
        scroller.scrollTop += 3 * (t - (prev ?? t))
        prev = t
        if (t - lastSample > 200) {
          lastSample = t
          for (const li of tiles()) {
            const r = li.getBoundingClientRect()
            if (r.bottom > 0 && r.top < innerHeight) {
              seen += 1
              const img = li.querySelector('img')
              if (img === null || !img.complete || img.naturalWidth === 0) {
                blank += 1
              }
            }
          }
        }
        if (t - start < 3000) {
          requestAnimationFrame(step)
        } else {
          resolve()
        }
      }
      requestAnimationFrame(step)
    })
    const stats = window.__bench.frames.stop()
    return {
      ...stats,
      blankRatio: seen ? blank / seen : 0,
      tiles: tiles().length,
    }
  })

export const homeVisit = async (ctx: BenchContext, runs: number) =>
  await repeat(ctx, runs, async (): Promise<Sample> => {
    const { page, close } = await open(
      { engine: 'chromium', kind: 'desktop' },
      { cpu: 4 }
    )
    try {
      await page.goto(`${ctx.origin}/`, { waitUntil: 'commit' })
      const heroInputMs = await mark(page, 'hero-input')
      // First input: type one character the moment the box shows, and time until the box holds it
      const input = 'input[placeholder="Search or paste a YouTube URL"]'
      await page.locator(input).pressSequentially('a')
      const interactiveMs = await settledNumber(
        await page.waitForFunction(
          (sel) =>
            document.querySelector<HTMLInputElement>(sel)?.value === 'a'
              ? performance.now()
              : null,
          input
        )
      )
      const carouselMs = await mark(page, 'carousel-slide')
      const chartsMs = await mark(page, 'charts-row')
      const chartsDoneMs = await mark(page, 'charts-done')
      const chartsRows = await page
        .locator(
          'section[aria-labelledby=charts-title] ul:not([aria-hidden]) > li'
        )
        .count()
      const galleryMs = await mark(page, 'gallery-tile')
      await page.waitForTimeout(1500)
      const paint = await page.evaluate(() => ({
        cls: window.__bench.cls,
        fcp: window.__bench.fcp,
        lcp: window.__bench.lcp,
      }))
      const next = await carouselNext(page)
      const scroll = await galleryScroll(page)
      return {
        values: {
          carouselMs,
          carouselNextFps: next.frames.fps,
          carouselNextMs: next.ms,
          chartsDoneMs,
          chartsMs,
          chartsRows,
          cls: paint.cls,
          fcpMs: paint.fcp,
          galleryBlankRatio: scroll.blankRatio,
          galleryDroppedRatio: scroll.droppedRatio,
          galleryFps: scroll.fps,
          galleryMs,
          galleryP95FrameMs: scroll.p95Ms,
          galleryScrollBlockingMs: scroll.longTaskMs,
          heroInputMs,
          interactiveMs,
          lcpMs: paint.lcp,
        },
      }
    } finally {
      await close()
    }
  })

declare global {
  interface Window {
    __benchScrollEnd: Promise<number>
  }
}
