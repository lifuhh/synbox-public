// One song, start to finish of a short session: the YouTube iframe appears, the player is ready, the lyrics data
// arrives, playback starts (autoplay), the first sung line shows, then pause, resume and a 5s seek, each timed from the press to the player's answer.
// The player exposes its state as [data-player-stage][data-phase]; the recorder timestamps every change.

import type { Page } from 'playwright'

import { mark, open } from '../engines/browser'
import type { BenchContext, Sample } from '../types'
import { phaseAfterInput, repeat, settledNumber } from './common'

/** The bottom bar hides after 1.8s idle; moving the pointer over the stage brings it back */
const showControls = async (page: Page) => {
  const box = await page.locator('[data-player-stage]').boundingBox()
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3)
    await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 3)
  }
  await page.waitForSelector(
    '[data-player-chrome] button[aria-label=Pause], [data-player-chrome] button[aria-label=Play]',
    {
      state: 'visible',
      timeout: 5000,
    }
  )
}

const seekLatency = async (page: Page): Promise<number> => {
  const before = await page
    .locator('[aria-label=Seek] [role=slider], [role=slider][aria-label=Seek]')
    .first()
    .getAttribute('aria-valuenow')
  await page.keyboard.press('ArrowRight')
  const handle = await page.waitForFunction(
    (b) => {
      const el = document.querySelector(
        '[aria-label=Seek] [role=slider], [role=slider][aria-label=Seek]'
      )
      const now = Number(el?.getAttribute('aria-valuenow'))
      return now >= Number(b) + 3
        ? performance.now() - (window.__bench.marks.input ?? 0)
        : null
    },
    before,
    { timeout: 10_000 }
  )
  return await settledNumber(handle)
}

export const playerSession =
  (videoId: string) => async (ctx: BenchContext, runs: number) =>
    await repeat(ctx, runs, async (): Promise<Sample> => {
      const { page, close } = await open(
        { engine: 'chromium', kind: 'desktop' },
        { cpu: 4 }
      )
      try {
        await page.goto(`${ctx.origin}/v/${videoId}`, { waitUntil: 'commit' })
        const iframeMs = await mark(page, 'player-iframe')
        const readyMs = await mark(page, 'phase-ready', 30_000)
        // Autoplay waits for the lyrics; Chrome runs with autoplay allowed, so this is the app's own start time
        const playingMs = await mark(page, 'phase-playing', 30_000)
        // When the lyrics data had arrived: the last Appwrite document read or karaoke timing response before playback
        const lyricsDataMs = await page.evaluate((playing) => {
          const ends = performance
            .getEntriesByType('resource')
            .filter(
              (e): e is PerformanceResourceTiming =>
                e instanceof PerformanceResourceTiming &&
                /appwrite.*\/documents|\/__lookup\/karaoke\//u.test(e.name)
            )
            .map((e) => e.responseEnd)
            .filter((t) => t <= playing)
          return ends.length ? Math.max(...ends) : Number.NaN
        }, playingMs)
        // The first sung line on screen; mostly the song's intro length, so a lyric-sync check more than a speed one
        const firstLineMs = await mark(page, 'lyrics-line', 60_000)
        await page.evaluate(() => {
          window.__bench.frames.start()
        })
        await page.waitForTimeout(6000)
        const playback = await page.evaluate(() => window.__bench.frames.stop())
        const lyricLines = await page.evaluate(
          () => window.__bench.lines.length
        )

        await showControls(page)
        await page.click('[data-player-chrome] button[aria-label=Pause]')
        const pauseMs = await phaseAfterInput(page, 'paused')
        await showControls(page)
        await page.click('[data-player-chrome] button[aria-label=Play]')
        const resumeMs = await phaseAfterInput(page, 'playing')
        const seekMs = await seekLatency(page)
        const paint = await page.evaluate(() => ({
          cls: window.__bench.cls,
          lcp: window.__bench.lcp,
        }))
        return {
          values: {
            cls: paint.cls,
            firstLineMs,
            iframeMs,
            lcpMs: paint.lcp,
            lyricLines,
            lyricsDataMs,
            pauseMs,
            playbackDroppedRatio: playback.droppedRatio,
            playbackFps: playback.fps,
            playbackP95FrameMs: playback.p95Ms,
            playingMs,
            readyMs,
            resumeMs,
            seekMs,
          },
        }
      } finally {
        await close()
      }
    })
