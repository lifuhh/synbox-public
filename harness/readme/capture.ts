// Raw screens of the app for the README, through the harness's silenced browsers (engines/browser.ts › open). Pick
// moments with harness/readme/moments.ts; compose the screens with harness/readme/compose.ts (Made for Phones) and
// harness/readme/scenes.ts (the rest).
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
//   bun harness/readme/capture.ts <outDir> player <videoId> <startSec>     the website's player and the upright
//                                                                           installed app's, most of the line lit; the
//                                                                           website again with Lyrics Style open
//   bun harness/readme/capture.ts <outDir> karaoke <videoId> <startSec> <endSec>
//                                                                           the website's stage in Theater, one frame
//                                                                           per step as the line is sung
//   bun harness/readme/capture.ts <outDir> search <query>                  the website's Search results
//   bun harness/readme/capture.ts <outDir> generate <videoId>              a generation part way through, on the
//                                                                           website and the upright installed app
//   --karaoke-style   lyrics in Karaoke Style (two rows) on every screen, as the listener's own default would set
//   --lyrics-size <n> Karaoke Style's size (lyricsFontSizeTwoLines; 0.6 to 1.05 on a phone on its side)
//   --site <origin>   the app to shoot (default https://synbox.io). A local `wt serve` shows staging's code; its
//                     karaoke, recommendations and YouTube reads are answered from the deployed services, which the
//                     dev server's stand-ins can't reach without the backend's keys
//
// The clips are shot while the song plays at a quarter speed, only the region that moves each time (WebKit takes
// about 250 ms for a full 3× shot); frames.json keeps the region and each frame's song time for the composer, and
// base.png the full screen the region sits in.
//
// `generate` is staged: a signed-in listener (probes/layout.ts › signIn) and the backend's generation streams answered
// in the page, held part way through the transcription. No request reaches the backend, and nothing is saved.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import type { BrowserContext, Page, Route } from 'playwright'

import {
  closeBrowsers,
  open,
  PWA_LANDSCAPE,
  PWA_PORTRAIT,
  replayFonts,
  VIEWPORTS,
  WEB,
} from '../bench/engines/browser'
import type { View } from '../bench/engines/browser'
import { signIn } from '../bench/probes/layout'
import { backendOrigins } from '../bench/replay'
import { repoAt, storeDir } from '../bench/store'
import { momentsOf } from './moments'

// The app's slowest speed, so WebKit's slow 3× shots still come about 20 to a second of the song
const SLOW = 0.25
// Where a local dev server's reads are answered from: the auth Worker serves karaoke and Home's recommendations, the
// site's function YouTube
const DEPLOYED: [RegExp, string][] = [
  [/\/api\/karaoke\//u, 'https://api.synbox.io'],
  [/\/api\/recommendations/u, 'https://api.synbox.io'],
  [/\/api\/youtube\//u, 'https://synbox.io'],
]
// The website's shots at 2×, like a laptop's screen
const WEB_SCALE = 2

// The unmute pill is hidden, never pressed: every driven browser stays silent (AGENTS.md). No scrollbar, as on a
// Mac, whose scrollbars draw over the page only while it scrolls: neither the browser's nor the one the app draws
// (doc-scroll.tsx), which shows while the mouse rests at the window's right edge, where mouseAway leaves it
const QUIET =
  '[data-unmute-pill], [data-scrollbar] { display: none } html { scrollbar-width: none }'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    // Sideways: switch the video's fit (Zoom to Fill / Fit), for a video whose own captions the default crop cuts
    'karaoke-style': { default: false, type: 'boolean' },
    'lyrics-size': { type: 'string' },
    'other-fit': { default: false, type: 'boolean' },
    site: { default: 'https://synbox.io', type: 'string' },
    theater: { default: false, type: 'boolean' },
  },
})
const [outDir, shot, subject, startArg, endArg] = positionals
if (outDir === undefined || shot === undefined || subject === undefined) {
  console.error(
    'Usage: bun harness/readme/capture.ts <outDir> home|sideways|upright|scout|player|karaoke|search|generate <videoId|query> [startSec] [endSec]'
  )
  process.exit(1)
}
const { site } = values
const start = Number(startArg ?? 0)
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
  // A slowed song takes four times as long to get there
  const deadline = Date.now() + 120_000
  // oxlint-disable-next-line eslint/no-await-in-loop -- polled until the song gets there
  while ((await songTime(page)) < atLeast) {
    if (Date.now() > deadline) {
      throw new Error(`the song never reached ${atLeast}s`)
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- polled until the song gets there
    await page.waitForTimeout(50)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

// A read answered from elsewhere; one still in flight when its page closes is dropped, not thrown
const forward = async (route: Route, to: string) => {
  try {
    await route.fulfill({ response: await route.fetch({ url: to }) })
  } catch {
    await route.abort().catch(() => {
      // The page is gone
    })
  }
}

const fromDeployed = async (context: BrowserContext) => {
  await Promise.all(
    DEPLOYED.map(async ([pattern, origin]) => {
      await context.route(pattern, async (route) => {
        const url = new URL(route.request().url())
        await forward(route, `${origin}${url.pathname}${url.search}`)
      })
    })
  )
  // The dev server's searches go to a local backend; the deployed lookup service answers them instead
  const { lookup } = backendOrigins(repoAt(process.cwd()).top)
  const search = /\/(?:library\/)?search$/u
  await context.route(
    (url) => url.origin !== new URL(site).origin && search.test(url.pathname),
    async (route) => {
      const url = new URL(route.request().url())
      const tail = search.exec(url.pathname)?.[0] ?? ''
      await forward(route, `${lookup}${tail}${url.search}`)
    }
  )
}

// A page of the site in one view: the deployed reads, the pill hidden, the embed's song time kept on window
const visit = async (view: View) => {
  // The library and recommendations as listeners see them, not the bench's recorded answers
  const opened = await open(view.surface, {
    lookup: 'live',
    ...(view.surface.kind === 'desktop' ? { scale: WEB_SCALE } : {}),
  })
  if (!site.startsWith('https://synbox.io')) {
    await fromDeployed(opened.context)
  }
  if (values['karaoke-style']) {
    // My Default's picks, stored before the app reads them (src/context/atoms.tsx › lyricsTwoLines,
    // lyricsFontSizeTwoLines); phones and Full Screen follow the default view's pick
    const size =
      values['lyrics-size'] === undefined ? null : Number(values['lyrics-size'])
    await opened.context.addInitScript((twoLinesSize) => {
      localStorage.setItem(
        'lyricsTwoLines',
        JSON.stringify({ default: true, theater: true })
      )
      if (twoLinesSize !== null) {
        localStorage.setItem(
          'lyricsFontSizeTwoLines',
          JSON.stringify(twoLinesSize)
        )
      }
    }, size)
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
  return opened
}

const player = async (view: View, leadSec = 6) => {
  const opened = await visit(view)
  await opened.page.goto(
    `${site}/v/${subject}?t=${Math.max(0, Math.floor(start - leadSec))}`,
    {
      timeout: 60_000,
      waitUntil: 'load',
    }
  )
  await opened.page.waitForSelector('[data-player-stage]', { timeout: 30_000 })
  await opened.page.waitForTimeout(6000)
  return opened
}

// Every image on screen has loaded (thumbnails are skeletons until their list arrives); a carousel's lazy images
// past the screen's right edge never load
const imagesLoaded = async (page: Page) => {
  await page
    .waitForFunction(
      () =>
        [...document.images].every((image) => {
          const box = image.getBoundingClientRect()
          return (
            (image.complete && image.naturalWidth > 0) ||
            box.top > innerHeight ||
            box.left >= innerWidth
          )
        }),
      undefined,
      { timeout: 20_000 }
    )
    .catch(() => {
      console.log('some images never loaded')
    })
}

// Off the stage and every control, so the website's floating UI hides
const mouseAway = async (page: Page) => {
  const { height, width } = page.viewportSize() ?? VIEWPORTS.desktop
  await page.mouse.move(width - 1, height - 1)
}

// The speed menu, as a person sets it: the stage's controls up (a tap on a phone, the mouse over it on a monitor)
const slowDown = async (page: Page, touch: boolean) => {
  if (touch) {
    await page.getByTestId('stage-input').tap()
  } else {
    const stage = await page.locator('[data-player-stage]').boundingBox()
    if (stage !== null) {
      await page.mouse.move(
        stage.x + stage.width / 2,
        stage.y + stage.height / 2
      )
    }
  }
  await page.waitForTimeout(400)
  const speed = page.getByRole('button', { name: /^playback speed/iu }).first()
  await (touch ? speed.tap() : speed.click())
  const option = page.getByRole('menuitemradio', { name: `${SLOW}×` })
  await (touch ? option.tap() : option.click())
  if (!touch) {
    await mouseAway(page)
  }
}

// The upright player: only the video and the lyric card move; the rest of the screen comes from one full shot after
const uprightClip = async (page: Page) =>
  await page.evaluate(() => {
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

// The website's watch page: the stage and the lyrics panel beside it, the box around both
const webClip = async (page: Page) =>
  await page.evaluate(() => {
    const boxes = [
      document.querySelector('[data-player-stage]'),
      document.querySelector('section.lyrics-sheet'),
    ].flatMap((element) =>
      element === null ? [] : [element.getBoundingClientRect()]
    )
    const left = Math.floor(Math.min(...boxes.map((box) => box.left)))
    const top = Math.floor(Math.min(...boxes.map((box) => box.top)))
    const right = Math.ceil(Math.max(...boxes.map((box) => box.right)))
    const bottom = Math.ceil(Math.max(...boxes.map((box) => box.bottom)))
    return { height: bottom - top, width: right - left, x: left, y: top }
  })

// One frame of `clip` after another while the song plays at SLOW, until the song passes `end`
const shootClip = async (
  page: Page,
  clip: { height: number; width: number; x: number; y: number },
  end: number,
  dir = outDir
) => {
  mkdirSync(dir, { recursive: true })
  const anchor = { song: await songTime(page), wall: Date.now() }
  const frames: { file: string; songSec: number }[] = []
  for (let songSec = anchor.song; songSec < end + 0.5;) {
    const file = `f${String(frames.length).padStart(3, '0')}.png`
    const shotAt = Date.now()
    // oxlint-disable-next-line eslint/no-await-in-loop -- frames are shot one after another as the song plays
    await page.screenshot({ clip, path: path.join(dir, file) })
    songSec =
      anchor.song + (((shotAt + Date.now()) / 2 - anchor.wall) / 1000) * SLOW
    frames.push({ file, songSec })
  }
  await page.screenshot({ path: path.join(dir, 'base.png') })
  writeFileSync(
    path.join(dir, 'frames.json'),
    `${JSON.stringify({ clip, frames }, null, 1)}\n`
  )
  const step = (frames.at(-1)?.songSec ?? 0) - (frames[0]?.songSec ?? 0)
  console.log(
    `${frames.length} frames over ${step.toFixed(2)} s of the song, clip ${clip.width}×${clip.height}`
  )
}

// The backend's generation streams, answered in the page so they stay open and arrive over time: the song checked
// and downloaded, then held part way through listening (a heartbeat every 5 s, as the backend sends)
const stageGeneration = async (
  context: BrowserContext,
  video: { channel: string; id: string; title: string }
) => {
  /* oxlint-disable unicorn/consistent-function-scoping -- runs in the page: nothing outside this function is there */
  await context.addInitScript((song) => {
    const real = window.fetch.bind(window)
    const encoder = new TextEncoder()
    const wait = async (ms: number) => {
      // oxlint-disable-next-line promise/avoid-new -- settles when the time passes
      await new Promise((resolve) => {
        setTimeout(resolve, ms)
      })
    }
    // `held` streams a heartbeat every 5 s after the steps and never closes
    const stream = (steps: [number, object][], held: boolean) =>
      new Response(
        new ReadableStream({
          async start(controller) {
            for (const [ms, message] of steps) {
              // oxlint-disable-next-line eslint/no-await-in-loop -- the messages arrive one after another
              await wait(ms)
              controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`))
            }
            if (!held) {
              controller.close()
              return
            }
            for (;;) {
              // oxlint-disable-next-line eslint/no-await-in-loop -- a heartbeat while the run is held
              await wait(5000)
              controller.enqueue(
                encoder.encode('{"type":"heartbeat","data":null}\n')
              )
            }
          },
        }),
        { headers: { 'content-type': 'application/x-ndjson' }, status: 200 }
      )
    const progress = (stage: string, extra: object = {}) => ({
      data: { stage, ...extra },
      type: 'progress',
    })
    const urlOf = (input: RequestInfo | URL) => {
      if (typeof input === 'string') {
        return input
      }
      return input instanceof URL ? input.href : input.url
    }
    const staged = async (input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = new URL(urlOf(input), location.href)
      if (pathname.endsWith('/generation-check')) {
        return Response.json({ ok: true })
      }
      if (pathname.endsWith('/validate')) {
        return stream(
          [
            [300, progress('check', { expected_s: 5 })],
            [
              1200,
              {
                data: {
                  full_vid_info: {
                    channel_name: song.channel,
                    duration: 240,
                    thumbnail: `https://i.ytimg.com/vi/${song.id}/hqdefault.jpg`,
                    title: song.title,
                  },
                },
                type: 'vid_info',
              },
            ],
            [100, progress('download', { expected_s: 8 })],
            [500, progress('download', { fraction: 0.5 })],
            [500, progress('download', { fraction: 1 })],
          ],
          false
        )
      }
      if (pathname.endsWith('/transcribev2')) {
        return stream(
          [
            [100, { data: { ahead: 0 }, type: 'queue' }],
            [200, progress('read', { expected_s: 6 })],
            [600, progress('separate', { expected_s: 12 })],
            [500, progress('separate', { fraction: 0.35 })],
            [500, progress('separate', { fraction: 0.7 })],
            [500, progress('separate', { fraction: 1 })],
            [200, progress('listen', { expected_s: 60 })],
            [800, progress('listen', { fraction: 0.55 })],
          ],
          true
        )
      }
      if (pathname.endsWith('/translate-annotate')) {
        return Response.error()
      }
      return await real(input, init)
    }
    // Defined, not assigned: the harness's types are Bun's, whose fetch has more members than a browser's
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      value: staged,
    })
  }, video)
  /* oxlint-enable unicorn/consistent-function-scoping */
}

mkdirSync(outDir, { recursive: true })

if (shot === 'home') {
  const { page, close } = await player(PWA_PORTRAIT)
  // The controls sit under the stage's touch layer while hidden, so the button gets its click directly
  await page
    .getByRole('button', { name: /^minimize player$/iu })
    .first()
    .dispatchEvent('click')
  await page.waitForSelector('[data-bench="charts-row"] img', {
    timeout: 30_000,
  })
  await imagesLoaded(page)
  await page.waitForTimeout(2000)
  await page.screenshot({ path: path.join(outDir, 'home.png') })
  await close()
} else if (shot === 'sideways') {
  // Opened 30 s ahead and played to the line, never seeked: in WebKit a seek leaves the video black for seconds
  const { page, close } = await player(PWA_LANDSCAPE, 30)
  if (values['other-fit']) {
    // The controls sit under the stage's touch layer while hidden, so the toggle gets its click directly
    await page
      .getByRole('button', { name: /^(?:zoom to fill|fit)/iu })
      .first()
      .dispatchEvent('click')
  }
  // The lead's play hides the controls; then most of the line is lit
  await waitForSong(page, start + 1.4)
  await page.screenshot({ path: path.join(outDir, 'sideways.png') })
  await close()
} else if (shot === 'scout') {
  // Every clean moment of the song, sideways, to choose the best-looking: scout-<line>.png, part way into each line
  const { page, close } = await player(PWA_LANDSCAPE, 0)
  for (const moment of await momentsOf(subject)) {
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
} else if (shot === 'player') {
  // The website, then the upright installed app, at the same moment; then the website with Lyrics Style open
  for (const view of [WEB, PWA_PORTRAIT]) {
    // No seek: in WebKit the video is still black and buffering when the line comes. The page opens well before
    // the line, and the controls hide by themselves before it
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    const { page, close } = await player(view, 30)
    if (view === WEB) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
      await mouseAway(page)
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await imagesLoaded(page)
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    if ((await songTime(page)) > start + 1) {
      throw new Error(`the song was past ${start}s before the shot`)
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await waitForSong(page, start + 1.4)
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await page.screenshot({
      path: path.join(outDir, `${view.name}-player.png`),
    })
    if (view === WEB) {
      // A click without moving the mouse, which would bring the stage's controls up
      // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
      await page
        .getByRole('button', { name: 'Lyrics Style' })
        .first()
        .dispatchEvent('click')
      // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
      await page.waitForTimeout(600)
      // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
      await page.screenshot({ path: path.join(outDir, 'web-style.png') })
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await close()
  }
} else if (shot === 'upright' && endArg !== undefined) {
  // No pause and no seek: either brings up YouTube's own centre button and the app's controls. The song starts
  // well before the line at the app's slowest speed, and the controls hide by themselves before the line comes
  const { page, close } = await player(PWA_PORTRAIT, 10)
  await slowDown(page, true)
  await waitForSong(page, start - 0.5)
  await shootClip(page, await uprightClip(page), Number(endArg))
  await close()
} else if (shot === 'hero' && endArg !== undefined) {
  // The website, then the upright installed app, each shot as the lines from startSec to endSec are sung, into
  // web/ and portrait/; scenes.ts plays them side by side on one song clock
  for (const view of [WEB, PWA_PORTRAIT]) {
    const touch = view === PWA_PORTRAIT
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    const { page, close } = await player(view, 10)
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await slowDown(page, touch)
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await imagesLoaded(page)
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await waitForSong(page, start - 0.5)
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    const clip = await (touch ? uprightClip(page) : webClip(page))
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await shootClip(
      page,
      clip,
      Number(endArg),
      path.join(outDir, touch ? 'portrait' : 'web')
    )
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await close()
  }
} else if (shot === 'karaoke' && endArg !== undefined) {
  // The stage alone, its controls hidden under a still mouse; --theater for Theater (the T key), whose lyrics
  // default to Karaoke Style's two rows
  const { page, close } = await player(WEB, 10)
  if (values.theater) {
    await page.keyboard.press('t')
    await page.waitForTimeout(1500)
  }
  await slowDown(page, false)
  await waitForSong(page, start - 0.5)
  const stage = await page.locator('[data-player-stage]').boundingBox()
  if (stage === null) {
    throw new Error('no stage on the page')
  }
  await shootClip(
    page,
    {
      height: Math.floor(stage.height),
      width: Math.floor(stage.width),
      x: Math.ceil(stage.x),
      y: Math.ceil(stage.y),
    },
    Number(endArg)
  )
  await close()
} else if (shot === 'search') {
  const { page, close } = await visit(WEB)
  await page.goto(`${site}/search?q=${encodeURIComponent(subject)}`, {
    timeout: 60_000,
    waitUntil: 'load',
  })
  await page.waitForSelector('main img', { timeout: 30_000 })
  // Rows mount as the results arrive, their thumbnails after them
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
    console.log('the network never went quiet')
  })
  await imagesLoaded(page)
  await mouseAway(page)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: path.join(outDir, 'web-search.png') })
  await close()
} else if (shot === 'generate') {
  // The song's own title and channel, from YouTube's public oEmbed
  const answer = await fetch(
    `https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${subject}`
  )
  const embed: unknown = await answer.json()
  const named = (key: string) => {
    const value = isRecord(embed) ? embed[key] : null
    return typeof value === 'string' ? value : ''
  }
  const video = {
    channel: named('author_name'),
    id: subject,
    title: named('title'),
  }
  for (const view of [WEB, PWA_PORTRAIT]) {
    const touch = view.surface.kind === 'phone'
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    const { context, page, close } = await visit(view)
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await signIn(page)
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await stageGeneration(context, video)
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await page.goto(`${site}/`, { timeout: 60_000, waitUntil: 'load' })
    const field = page.locator('[data-bench="hero-input"]')
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await field.fill(`https://www.youtube.com/watch?v=${subject}`)
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await page.waitForTimeout(2500)
    const go = page.getByRole('button', { name: /^generate lyrics$/iu }).first()
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await (touch ? go.tap() : go.click())
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await page.waitForTimeout(9000)
    if (!touch) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
      await mouseAway(page)
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await imagesLoaded(page)
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await page.screenshot({
      path: path.join(outDir, `${view.name}-generate.png`),
    })
    // oxlint-disable-next-line eslint/no-await-in-loop -- one view after another
    await close()
  }
} else {
  console.error(`Unknown shot "${shot}" (or upright/karaoke without endSec)`)
  process.exit(1)
}
await closeBrowsers()
