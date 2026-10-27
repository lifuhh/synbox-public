// Raw screens of the app for the README, through the harness's silenced browsers (engines/browser.ts › open). Pick
// moments with harness/readme/moments.ts; compose the screens with harness/readme/compose.ts.
//
//   bun harness/readme/capture.ts <outDir> home <videoId> <startSec>       the installed app's Home, the song in the
//                                                                           mini player
//   bun harness/readme/capture.ts <outDir> sideways <videoId> <startSec>   the installed app on its side (it opens
//                                                                           the player in Full Screen), most of the
//                                                                           line at startSec lit
//   bun harness/readme/capture.ts <outDir> upright <videoId> <startSec> <endSec>
//                                                                           the upright player, one frame per step as
//                                                                           the line from startSec to endSec is sung
//   bun harness/readme/capture.ts <outDir> scout <videoId> 0               the song on its side at each of its clean
//                                                                           moments (moments.ts), to pick from
//   --site <origin>   the app to shoot (default https://synbox.io). A local `wt serve` shows staging's code; its
//                     karaoke and YouTube reads are answered from the deployed services, which the dev server's
//                     stand-ins can't reach without the backend's keys
//
// The clip is shot while the song plays at a quarter speed, only the video and lyric card each time (WebKit takes
// about 250 ms for a full 3× shot); frames.json keeps the region and each frame's song time for the composer, and
// base.png the full screen the region sits in.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import type { BrowserContext, Page } from 'playwright'

import {
  closeBrowsers,
  open,
  PWA_LANDSCAPE,
  PWA_PORTRAIT,
  replayFonts,
} from '../bench/engines/browser'
import { repoAt, storeDir } from '../bench/store'
import { momentsOf } from './moments'

// The app's slowest speed, so WebKit's slow 3× shots still come about 20 to a second of the song
const SLOW = 0.25
// Where a local dev server's reads are answered from: the auth Worker serves karaoke, the site's function YouTube
const DEPLOYED: [RegExp, string][] = [
  [/\/api\/karaoke\//u, 'https://api.synbox.io'],
  [/\/api\/youtube\//u, 'https://synbox.io'],
]

// The unmute pill is hidden, never pressed: every driven browser stays silent (AGENTS.md)
const QUIET = '[data-unmute-pill] { display: none }'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    // Sideways: switch the video's fit (Zoom to Fill / Fit), for a video whose own captions the default crop cuts
    'other-fit': { default: false, type: 'boolean' },
    site: { default: 'https://synbox.io', type: 'string' },
  },
})
const [outDir, shot, videoId, startArg, endArg] = positionals
if (
  outDir === undefined ||
  shot === undefined ||
  videoId === undefined ||
  startArg === undefined
) {
  console.error(
    'Usage: bun harness/readme/capture.ts <outDir> home|sideways|upright <videoId> <startSec> [endSec]'
  )
  process.exit(1)
}
const { site } = values
const start = Number(startArg)
// WebKit stalls on the live Japanese font's many subset requests, so fonts come from the bench's recorded copy
replayFonts(storeDir(repoAt(process.cwd()), 'bench', 'fixtures', 'fonts'))

// The YouTube embed takes commands by postMessage, as its iframe API does
const youtube = async (page: Page, func: string, args: unknown[] = []) => {
  await page.evaluate(
    ([name, list]) => {
      const frame = document.querySelector<HTMLIFrameElement>(
        'iframe[src*="youtube"]'
      )
      frame?.contentWindow?.postMessage(
        JSON.stringify({ args: list, event: 'command', func: name }),
        '*'
      )
    },
    [func, args] as const
  )
}

// The song time the embed reports in its infoDelivery messages, kept on window by an init script
declare global {
  interface Window {
    __songSec?: number
  }
}
const songTime = async (page: Page) =>
  await page.evaluate(() => window.__songSec ?? -1)

const waitForSong = async (page: Page, atLeast: number) => {
  const deadline = Date.now() + 40_000
  // oxlint-disable-next-line eslint/no-await-in-loop -- polled until the song gets there
  while ((await songTime(page)) < atLeast) {
    if (Date.now() > deadline) {
      throw new Error(`the song never reached ${atLeast}s`)
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- polled until the song gets there
    await page.waitForTimeout(50)
  }
}

const fromDeployed = async (context: BrowserContext) => {
  await Promise.all(
    DEPLOYED.map(async ([pattern, origin]) => {
      await context.route(pattern, async (route) => {
        const url = new URL(route.request().url())
        const response = await route.fetch({
          url: `${origin}${url.pathname}${url.search}`,
        })
        await route.fulfill({ response })
      })
    })
  )
}

const player = async (view: typeof PWA_PORTRAIT, leadSec = 6) => {
  // The library and recommendations as listeners see them, not the bench's recorded answers
  const opened = await open(view.surface, { lookup: 'live' })
  if (!site.startsWith('https://synbox.io')) {
    await fromDeployed(opened.context)
  }
  await opened.context.addInitScript((css) => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.textContent = css
      document.head.append(style)
    })
    addEventListener('message', (event) => {
      if (
        typeof event.data !== 'string' ||
        !event.data.includes('currentTime')
      ) {
        return
      }
      const message: unknown = JSON.parse(event.data)
      const info =
        typeof message === 'object' && message !== null && 'info' in message
          ? message.info
          : null
      if (
        typeof info === 'object' &&
        info !== null &&
        'currentTime' in info &&
        typeof info.currentTime === 'number'
      ) {
        window.__songSec = info.currentTime
      }
    })
  }, QUIET)
  await opened.page.goto(
    `${site}/v/${videoId}?t=${Math.max(0, Math.floor(start - leadSec))}`,
    {
      timeout: 60_000,
      waitUntil: 'load',
    }
  )
  await opened.page.waitForSelector('[data-player-stage]', { timeout: 30_000 })
  await opened.page.waitForTimeout(6000)
  return opened
}

mkdirSync(outDir, { recursive: true })

if (shot === 'home') {
  const { page, close } = await player(PWA_PORTRAIT)
  // The controls sit under the stage's touch layer while hidden, so the button gets its click directly
  await page
    .getByRole('button', { name: /^minimize player$/iu })
    .first()
    .dispatchEvent('click')
  // The charts' rows show their thumbnails (skeletons until the list arrives), and every image on screen has loaded
  await page.waitForSelector('[data-bench="charts-row"] img', {
    timeout: 30_000,
  })
  await page
    .waitForFunction(
      () =>
        [...document.images].every(
          (image) =>
            (image.complete && image.naturalWidth > 0) ||
            image.getBoundingClientRect().top > innerHeight
        ),
      undefined,
      { timeout: 20_000 }
    )
    .catch(() => {
      console.log('some images never loaded')
    })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: path.join(outDir, 'home.png') })
  await close()
} else if (shot === 'sideways') {
  const { page, close } = await player(PWA_LANDSCAPE)
  if (values['other-fit']) {
    // The controls sit under the stage's touch layer while hidden, so the toggle gets its click directly
    await page
      .getByRole('button', { name: /^(?:zoom to fill|fit)/iu })
      .first()
      .dispatchEvent('click')
  }
  // Five seconds of play hides the controls (a seek by the embed's API is no activity); then most of the line is lit
  await youtube(page, 'seekTo', [start - 5, true])
  await waitForSong(page, start + 1.4)
  await page.screenshot({ path: path.join(outDir, 'sideways.png') })
  await close()
} else if (shot === 'scout') {
  // Every clean moment of the song, sideways, to choose the best-looking: scout-<line>.png, part way into each line
  const { page, close } = await player(PWA_LANDSCAPE, 0)
  for (const moment of await momentsOf(videoId)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one moment after another, in one player
    await youtube(page, 'seekTo', [moment.start - 5, true])
    // oxlint-disable-next-line eslint/no-await-in-loop -- one moment after another, in one player
    await waitForSong(page, moment.start + (moment.end - moment.start) * 0.6)
    // oxlint-disable-next-line eslint/no-await-in-loop -- one moment after another, in one player
    await page.screenshot({
      path: path.join(
        outDir,
        `scout-${String(moment.line).padStart(2, '0')}.png`
      ),
    })
    console.log(`line ${moment.line} at ${moment.start.toFixed(1)}s`)
  }
  await close()
} else if (shot === 'upright' && endArg !== undefined) {
  const end = Number(endArg)
  // No pause and no seek: either brings up YouTube's own centre button and the app's controls. The song starts
  // well before the line at the app's slowest speed, and the controls hide by themselves before the line comes
  const { page, close } = await player(PWA_PORTRAIT, 10)
  // A tap on the stage brings the controls up; then the speed menu, as a person would set it
  await page.getByTestId('stage-input').tap()
  await page.waitForTimeout(400)
  await page
    .getByRole('button', { name: /^playback speed/iu })
    .first()
    .tap()
  await page.getByRole('menuitemradio', { name: `${SLOW}×` }).tap()
  await waitForSong(page, start - 0.5)
  // Only the video and the lyric card move; the rest of the screen comes from one full shot after the clip
  const clip = await page.evaluate(() => {
    const card = document
      .querySelector('section.lyrics-sheet')
      ?.getBoundingClientRect()
    const bottom = card === undefined ? innerHeight : card.bottom
    return {
      height: Math.min(innerHeight, Math.ceil(bottom + 8)),
      width: innerWidth,
      x: 0,
      y: 0,
    }
  })
  const anchor = { song: await songTime(page), wall: Date.now() }
  const frames: { file: string; songSec: number }[] = []
  for (let songSec = anchor.song; songSec < end + 0.5;) {
    const file = `f${String(frames.length).padStart(3, '0')}.png`
    const shotAt = Date.now()
    // oxlint-disable-next-line eslint/no-await-in-loop -- frames are shot one after another as the song plays
    await page.screenshot({ clip, path: path.join(outDir, file) })
    songSec =
      anchor.song + (((shotAt + Date.now()) / 2 - anchor.wall) / 1000) * SLOW
    frames.push({ file, songSec })
  }
  await page.screenshot({ path: path.join(outDir, 'base.png') })
  writeFileSync(
    path.join(outDir, 'frames.json'),
    `${JSON.stringify({ clip, frames }, null, 1)}\n`
  )
  const step = (frames.at(-1)?.songSec ?? 0) - (frames[0]?.songSec ?? 0)
  console.log(
    `${frames.length} frames over ${step.toFixed(2)} s of the song, clip ${clip.width}×${clip.height}`
  )
  await close()
} else {
  console.error(`Unknown shot "${shot}" (or upright without endSec)`)
  process.exit(1)
}
await closeBrowsers()
