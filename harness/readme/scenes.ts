// The README's other images, from capture.ts's shots: the website in a browser window, with the upright installed
// app beside it where both are shown. Transparent backgrounds, so they sit on GitHub's light and dark themes alike;
// 1600px wide like the phones scene.
//
//   bun harness/readme/scenes.ts <outDir> [--raw <dir>] [--hero <dir> --hero-from <s> --hero-to <s>]
//                                [--karaoke <dir> --karaoke-from <s> --karaoke-to <s>] [--keep]
//
// --raw holds capture.ts's `player`, `search` and `generate` shots; they make style, search and generate.webp, and a
// still hero.webp unless --hero is given. --hero is capture.ts's `hero` output (web/ and portrait/): hero.webp plays
// both on one song clock. --karaoke is capture.ts's `karaoke` output: karaoke.webp, the stage as the lines are sung.
// Clips are trimmed by song time.

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { closeBrowsers, open, WEB } from '../bench/engines/browser'
import { browser, browserHeight, CSS, outer, phone } from './devices'

// Every image comes out this wide
const OUT_WIDTH = 1600
// The phone beside a browser window, scaled to stand about as tall as the window
const BESIDE = 0.78
// The stage's own corners, cut from the shot so no page background shows around them
const STAGE_RADIUS = 16
// A clip's last frame holds a little before the loop starts again
const HOLD_MS = 700

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    hero: { type: 'string' },
    'hero-from': { type: 'string' },
    'hero-to': { type: 'string' },
    karaoke: { type: 'string' },
    'karaoke-from': { type: 'string' },
    'karaoke-to': { type: 'string' },
    // Keep the rendered pages and frames beside the output, to look at before they go anywhere
    keep: { default: false, type: 'boolean' },
    raw: { type: 'string' },
  },
})
const [outDir] = positionals
if (outDir === undefined) {
  console.error(
    'Usage: bun harness/readme/scenes.ts <outDir> [--raw <dir>] [--hero <dir> --hero-from s --hero-to s] [--karaoke <dir> --karaoke-from s --karaoke-to s] [--keep]'
  )
  process.exit(1)
}

const file = (p: string) => pathToFileURL(path.resolve(p)).href

const front = outer(false)
const phoneSize = {
  height: front.height * BESIDE,
  width: front.width * BESIDE,
}

interface Frame {
  file: string
  songSec: number
}
interface Box {
  height: number
  width: number
  x: number
  y: number
}
const isFrame = (value: unknown): value is Frame =>
  typeof value === 'object' &&
  value !== null &&
  'file' in value &&
  typeof value.file === 'string' &&
  'songSec' in value &&
  typeof value.songSec === 'number'
const isBox = (value: unknown): value is Box =>
  typeof value === 'object' &&
  value !== null &&
  'height' in value &&
  typeof value.height === 'number' &&
  'width' in value &&
  typeof value.width === 'number' &&
  'x' in value &&
  typeof value.x === 'number' &&
  'y' in value &&
  typeof value.y === 'number'

/** A capture.ts clip folder: the region it shot, its frames between `from` and `to` (song seconds), its full screen */
const readClip = (dir: string, from?: string, to?: string) => {
  const captured: unknown = JSON.parse(
    readFileSync(path.join(dir, 'frames.json'), 'utf-8')
  )
  const record =
    typeof captured === 'object' && captured !== null ? captured : {}
  const clip = 'clip' in record && isBox(record.clip) ? record.clip : null
  const start = Number(from ?? -Infinity)
  const end = Number(to ?? Infinity)
  const frames = (
    'frames' in record && Array.isArray(record.frames) ? record.frames : []
  )
    .filter(isFrame)
    .filter((frame) => frame.songSec >= start && frame.songSec <= end)
    .map((frame) => ({ ...frame, src: file(path.join(dir, frame.file)) }))
  if (clip === null || frames.length < 2) {
    console.error(
      `${dir}: no clip, or only ${frames.length} frames between ${start} and ${end}`
    )
    process.exit(1)
  }
  return { base: file(path.join(dir, 'base.png')), clip, frames }
}

interface Scene {
  name: string
  width: number
  height: number
  html: string
}

// The browser window with the phone at its bottom right (hero) or bottom left (generate); `web` and `portrait` are
// the full shots, each with an optional clip laid over its moving part
const pair = (
  name: string,
  side: 'left' | 'right',
  web: { src: string; clip?: Box },
  portrait: string
): Scene => {
  const width = 1280
  const height = 800
  const windowWidth = 1120
  const phoneX = side === 'right' ? width - phoneSize.width : 0
  const layers =
    web.clip === undefined
      ? [{ src: portrait }]
      : [{ src: portrait }, { id: 'portrait-clip', src: portrait }]
  return {
    height,
    html: `${browser({
      ...(web.clip === undefined
        ? {}
        : { clip: { box: web.clip, id: 'web-clip', src: web.src } }),
      src: web.src,
      width: windowWidth,
      x: side === 'right' ? 0 : width - windowWidth,
      y: 0,
    })}
${phone({ id: name, layers, scale: BESIDE, x: phoneX, y: height - phoneSize.height })}`,
    name,
    width,
  }
}

const alone = (name: string, src: string): Scene => {
  const width = 1200
  return {
    height: Math.ceil(browserHeight(width)),
    html: browser({ src, width, x: 0, y: 0 }),
    name,
    width,
  }
}

const work = path.join(path.resolve(outDir), '.scenes')
rmSync(work, { force: true, recursive: true })
mkdirSync(work, { recursive: true })

const page = (scene: Scene) => {
  const html = path.join(work, `${scene.name}.html`)
  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
<body><div style="position:relative;width:${scene.width}px;height:${scene.height}px">${scene.html}</div></body>`
  )
  return pathToFileURL(html).href
}

const encode = (args: string[]) => {
  const [tool = '', ...rest] = args
  const done = spawnSync(tool, rest, { encoding: 'utf-8' })
  if (done.status !== 0) {
    console.error(`${tool} failed: ${done.stderr}`)
    process.exit(1)
  }
}

/** One still: the scene shot once, as a WebP */
const still = async (scene: Scene) => {
  const { page: tab, close } = await open(WEB.surface, {
    scale: OUT_WIDTH / scene.width,
  })
  await tab.goto(page(scene), { waitUntil: 'load' })
  const png = path.join(work, `${scene.name}.png`)
  await tab.screenshot({
    clip: { height: scene.height, width: scene.width, x: 0, y: 0 },
    omitBackground: true,
    path: png,
  })
  await close()
  const out = path.join(outDir, `${scene.name}.webp`)
  encode(['cwebp', '-quiet', '-q', '88', '-m', '6', png, '-o', out])
  console.log(out)
}

/** One animated WebP: per step, the images named by id get their new sources, then the scene is shot */
const animate = async (
  scene: Scene,
  steps: { images: Record<string, string>; ms: number }[]
) => {
  const { page: tab, close } = await open(WEB.surface, {
    scale: OUT_WIDTH / scene.width,
  })
  await tab.goto(page(scene), { waitUntil: 'load' })
  const shots: { file: string; ms: number }[] = []
  for (const [i, step] of steps.entries()) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one frame drawn, then shot, then the next
    await tab.evaluate(async (images) => {
      await Promise.all(
        Object.entries(images).map(async ([id, src]) => {
          const image = document.querySelector<HTMLImageElement>(`#${id}`)
          if (image && image.src !== src) {
            image.src = src
            await image.decode()
          }
        })
      )
    }, step.images)
    const shot = path.join(
      work,
      `${scene.name}-${String(i).padStart(3, '0')}.png`
    )
    // oxlint-disable-next-line eslint/no-await-in-loop -- one frame drawn, then shot, then the next
    await tab.screenshot({
      clip: { height: scene.height, width: scene.width, x: 0, y: 0 },
      omitBackground: true,
      path: shot,
    })
    shots.push({ file: shot, ms: step.ms })
  }
  await close()
  const args = ['img2webp', '-loop', '0', '-lossy', '-q', '78', '-m', '6']
  for (const shot of shots) {
    args.push('-d', String(shot.ms), shot.file)
  }
  const out = path.join(outDir, `${scene.name}.webp`)
  encode([...args, '-o', out])
  console.log(`${out}: ${shots.length} frames`)
}

// Each frame's time on screen: until the next frame's song time, the last one held
const durations = (frames: Frame[]) =>
  frames.map((frame, i) => {
    const next = frames[i + 1]
    return next === undefined
      ? HOLD_MS
      : Math.round((next.songSec - frame.songSec) * 1000)
  })

if (values.raw !== undefined) {
  const { raw } = values
  const shotOf = (name: string) => file(path.join(raw, `${name}.png`))
  const scenes = [
    pair(
      'generate',
      'left',
      { src: shotOf('web-generate') },
      shotOf('pwa-portrait-generate')
    ),
    alone('style', shotOf('web-style')),
    alone('search', shotOf('web-search')),
  ]
  if (values.hero === undefined) {
    scenes.unshift(
      pair(
        'hero',
        'right',
        { src: shotOf('web-player') },
        shotOf('pwa-portrait-player')
      )
    )
  }
  for (const scene of scenes) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one scene after another
    await still(scene)
  }
}

if (values.hero !== undefined) {
  const from = values['hero-from']
  const to = values['hero-to']
  const web = readClip(path.join(values.hero, 'web'), from, to)
  const portrait = readClip(path.join(values.hero, 'portrait'), from, to)
  const scene = pair(
    'hero',
    'right',
    { clip: web.clip, src: web.base },
    portrait.base
  )
  // The website's frames set the pace; the phone shows its latest frame at each one's song time
  const ms = durations(web.frames)
  const steps = web.frames.map((frame, i) => {
    const phoneFrame =
      portrait.frames.findLast((p) => p.songSec <= frame.songSec) ??
      portrait.frames[0]
    return {
      images: {
        'portrait-clip': phoneFrame?.src ?? portrait.base,
        'web-clip': frame.src,
      },
      ms: ms[i] ?? HOLD_MS,
    }
  })
  await animate(scene, steps)
}

if (values.karaoke !== undefined) {
  const stage = readClip(
    values.karaoke,
    values['karaoke-from'],
    values['karaoke-to']
  )
  const scene: Scene = {
    height: stage.clip.height,
    html: `<img id="clip" src="${stage.frames[0]?.src ?? ''}" style="display:block;width:100%;border-radius:${STAGE_RADIUS}px">`,
    name: 'karaoke',
    width: stage.clip.width,
  }
  const ms = durations(stage.frames)
  await animate(
    scene,
    stage.frames.map((frame, i) => ({
      images: { clip: frame.src },
      ms: ms[i] ?? HOLD_MS,
    }))
  )
}

await closeBrowsers()
if (!values.keep) {
  rmSync(work, { force: true, recursive: true })
}
