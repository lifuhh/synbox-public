// The README's other images, from capture.ts's shots in <raw>: the website in a browser window, with the upright
// installed app beside it where both are shown. Transparent backgrounds, so they sit on GitHub's light and dark themes
// alike; 1600px wide like the phones scene.
//
//   bun harness/readme/scenes.ts <outDir> --raw <dir> [--karaoke <dir> --from <sec> --to <sec>] [--keep]
//
// <raw> holds capture.ts's `player`, `search` and `generate` shots; they make hero, style, search and generate.webp.
// --karaoke is capture.ts's `karaoke` output; it makes karaoke.webp, one animated WebP of the stage as the line is
// sung, trimmed by song time.

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
// The clip's last frame holds a little before the loop starts again
const HOLD_MS = 700

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    from: { type: 'string' },
    karaoke: { type: 'string' },
    // Keep the rendered pages and frames beside the output, to look at before they go anywhere
    keep: { default: false, type: 'boolean' },
    raw: { type: 'string' },
    to: { type: 'string' },
  },
})
const [outDir] = positionals
const { raw } = values
if (outDir === undefined || raw === undefined) {
  console.error(
    'Usage: bun harness/readme/scenes.ts <outDir> --raw <dir> [--karaoke <dir> --from <s> --to <s>] [--keep]'
  )
  process.exit(1)
}

const file = (p: string) => pathToFileURL(path.resolve(p)).href
const shotOf = (name: string) => file(path.join(raw, `${name}.png`))

const front = outer(false)
const phoneSize = {
  height: front.height * BESIDE,
  width: front.width * BESIDE,
}

const isFrame = (value: unknown): value is { file: string; songSec: number } =>
  typeof value === 'object' &&
  value !== null &&
  'file' in value &&
  typeof value.file === 'string' &&
  'songSec' in value &&
  typeof value.songSec === 'number'

interface Scene {
  name: string
  width: number
  height: number
  html: string
}

// The browser window with the phone at its bottom right (hero) or bottom left (generate)
const pair = (
  name: string,
  web: string,
  portrait: string,
  side: 'left' | 'right'
): Scene => {
  const width = 1280
  const height = 800
  const windowWidth = 1120
  const phoneX = side === 'right' ? width - phoneSize.width : 0
  return {
    height,
    html: `${browser({ src: shotOf(web), width: windowWidth, x: side === 'right' ? 0 : width - windowWidth, y: 0 })}
${phone({ id: name, layers: [{ src: shotOf(portrait) }], scale: BESIDE, x: phoneX, y: height - phoneSize.height })}`,
    name,
    width,
  }
}

const alone = (name: string, web: string): Scene => {
  const width = 1200
  return {
    height: Math.ceil(browserHeight(width)),
    html: browser({ src: shotOf(web), width, x: 0, y: 0 }),
    name,
    width,
  }
}

const SCENES: Scene[] = [
  pair('hero', 'web-player', 'pwa-portrait-player', 'right'),
  pair('generate', 'web-generate', 'pwa-portrait-generate', 'left'),
  alone('style', 'web-style'),
  alone('search', 'web-search'),
]

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

for (const scene of SCENES) {
  // oxlint-disable-next-line eslint/no-await-in-loop -- one scene after another
  const { page: tab, close } = await open(WEB.surface, {
    scale: OUT_WIDTH / scene.width,
  })
  // oxlint-disable-next-line eslint/no-await-in-loop -- one scene after another
  await tab.goto(page(scene), { waitUntil: 'load' })
  const png = path.join(work, `${scene.name}.png`)
  // oxlint-disable-next-line eslint/no-await-in-loop -- one scene after another
  await tab.screenshot({
    clip: { height: scene.height, width: scene.width, x: 0, y: 0 },
    omitBackground: true,
    path: png,
  })
  // oxlint-disable-next-line eslint/no-await-in-loop -- one scene after another
  await close()
  const out = path.join(outDir, `${scene.name}.webp`)
  encode(['cwebp', '-quiet', '-q', '88', '-m', '6', png, '-o', out])
  console.log(out)
}

if (values.karaoke !== undefined) {
  const dir = values.karaoke
  const captured: unknown = JSON.parse(
    readFileSync(path.join(dir, 'frames.json'), 'utf-8')
  )
  const record =
    typeof captured === 'object' && captured !== null ? captured : {}
  const clip =
    'clip' in record &&
    typeof record.clip === 'object' &&
    record.clip !== null &&
    'width' in record.clip &&
    'height' in record.clip &&
    typeof record.clip.width === 'number' &&
    typeof record.clip.height === 'number'
      ? { height: record.clip.height, width: record.clip.width }
      : null
  const all =
    'frames' in record && Array.isArray(record.frames)
      ? record.frames.filter(isFrame)
      : []
  const from = Number(values.from ?? -Infinity)
  const to = Number(values.to ?? Infinity)
  const frames = all.filter(
    (frame) => frame.songSec >= from && frame.songSec <= to
  )
  if (clip === null || frames.length < 2) {
    console.error(
      `${dir}: no clip, or only ${frames.length} frames between ${from} and ${to}`
    )
    process.exit(1)
  }
  const scene: Scene = {
    height: clip.height,
    html: `<img id="clip" src="${file(path.join(dir, frames[0]?.file ?? ''))}" style="display:block;width:100%;border-radius:${STAGE_RADIUS}px">`,
    name: 'karaoke',
    width: clip.width,
  }
  const { page: tab, close } = await open(WEB.surface, {
    scale: OUT_WIDTH / clip.width,
  })
  await tab.goto(page(scene), { waitUntil: 'load' })
  const shots: { file: string; ms: number }[] = []
  for (const [i, frame] of frames.entries()) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one frame drawn, then shot, then the next
    await tab.evaluate(
      async (src) => {
        const image = document.querySelector<HTMLImageElement>('#clip')
        if (image) {
          image.src = src
          await image.decode()
        }
      },
      file(path.join(dir, frame.file))
    )
    const shot = path.join(work, `k${String(i).padStart(3, '0')}.png`)
    // oxlint-disable-next-line eslint/no-await-in-loop -- one frame drawn, then shot, then the next
    await tab.screenshot({
      clip: { height: clip.height, width: clip.width, x: 0, y: 0 },
      omitBackground: true,
      path: shot,
    })
    const next = frames[i + 1]
    shots.push({
      file: shot,
      ms:
        next === undefined
          ? HOLD_MS
          : Math.round((next.songSec - frame.songSec) * 1000),
    })
  }
  await close()
  const args = ['img2webp', '-loop', '0', '-lossy', '-q', '80', '-m', '6']
  for (const shot of shots) {
    args.push('-d', String(shot.ms), shot.file)
  }
  const out = path.join(outDir, 'karaoke.webp')
  encode([...args, '-o', out])
  console.log(`${out}: ${shots.length} frames`)
}

await closeBrowsers()
if (!values.keep) {
  rmSync(work, { force: true, recursive: true })
}
