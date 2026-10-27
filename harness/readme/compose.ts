// The README's Made for Phones scene, from capture.ts's shots: the app on its side, large, at the back; the installed
// Home and the upright player in front, bottom left and right; the upright player's lyric card filling as it is sung.
// One animated WebP with a transparent background, so it sits on GitHub's light and dark themes alike.
//
//   bun harness/readme/compose.ts <out.webp> --sideways <png> --home <png> --upright <dir> --from <sec> --to <sec>
//
// <dir> is capture.ts's upright output (frames.json, base.png, fNNN.png); --from/--to trim the clip by song time.

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { closeBrowsers, open, WEB } from '../bench/engines/browser'
import { CSS, outer, phone } from './devices'

// The scene in CSS px, shot at 2×: fits the desktop view's 1440×900
const SCENE = { height: 700, width: 1400 }
const BACK = 1.32
const FRONT = 0.76
const INSET = 40
// The last frame holds a little before the loop starts again
const HOLD_MS = 700

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    from: { type: 'string' },
    home: { type: 'string' },
    // Keep the rendered frames beside the output, to look at before it goes anywhere
    keep: { default: false, type: 'boolean' },
    sideways: { type: 'string' },
    to: { type: 'string' },
    upright: { type: 'string' },
  },
})
const [out] = positionals
const { home, sideways, upright } = values
if (
  out === undefined ||
  home === undefined ||
  sideways === undefined ||
  upright === undefined
) {
  console.error(
    'Usage: bun harness/readme/compose.ts <out.webp> --sideways <png> --home <png> --upright <dir> [--from s] [--to s]'
  )
  process.exit(1)
}

interface Frame {
  file: string
  songSec: number
}
const isFrame = (value: unknown): value is Frame =>
  typeof value === 'object' &&
  value !== null &&
  'file' in value &&
  typeof value.file === 'string' &&
  'songSec' in value &&
  typeof value.songSec === 'number'
const captured: unknown = JSON.parse(
  readFileSync(path.join(upright, 'frames.json'), 'utf-8')
)
const all =
  typeof captured === 'object' &&
  captured !== null &&
  'frames' in captured &&
  Array.isArray(captured.frames)
    ? captured.frames.filter(isFrame)
    : []
const from = Number(values.from ?? -Infinity)
const to = Number(values.to ?? Infinity)
const frames = all.filter(
  (frame) => frame.songSec >= from && frame.songSec <= to
)
if (frames.length < 2) {
  console.error(`only ${frames.length} frames between ${from} and ${to}`)
  process.exit(1)
}

const file = (p: string) => pathToFileURL(path.resolve(p)).href
const back = outer(true)
const front = outer(false)
const frontTop = (SCENE.height - front.height * FRONT) / 2
const backTop = (SCENE.height - back.height * BACK) / 2
const html = `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
<body><div id="scene" style="position:relative;width:${SCENE.width}px;height:${SCENE.height}px">
${phone({ id: 'sideways', land: true, layers: [{ src: file(sideways) }], scale: BACK, x: (SCENE.width - back.width * BACK) / 2, y: backTop })}
${phone({ id: 'home', layers: [{ src: file(home) }], scale: FRONT, x: INSET, y: frontTop })}
${phone({
  id: 'upright',
  layers: [
    { src: file(path.join(upright, 'base.png')) },
    { id: 'clip', src: file(path.join(upright, frames[0]?.file ?? '')) },
  ],
  scale: FRONT,
  x: SCENE.width - INSET - front.width * FRONT,
  y: frontTop,
})}
</div></body>`

const work = path.join(path.dirname(path.resolve(out)), '.compose')
rmSync(work, { force: true, recursive: true })
mkdirSync(work, { recursive: true })
const page = path.join(work, 'scene.html')
writeFileSync(page, html)

const { page: tab, close } = await open(WEB.surface, { scale: 2 })
await tab.goto(pathToFileURL(page).href, { waitUntil: 'load' })
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
    file(path.join(upright, frame.file))
  )
  const shot = path.join(work, `s${String(i).padStart(3, '0')}.png`)
  // oxlint-disable-next-line eslint/no-await-in-loop -- one frame drawn, then shot, then the next
  await tab.screenshot({
    clip: { height: SCENE.height, width: SCENE.width, x: 0, y: 0 },
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
await closeBrowsers()

const args = ['-loop', '0', '-lossy', '-q', '80', '-m', '6']
for (const shot of shots) {
  args.push('-d', String(shot.ms), shot.file)
}
const encoded = spawnSync('img2webp', [...args, '-o', out], {
  encoding: 'utf-8',
})
if (encoded.status !== 0) {
  console.error(`img2webp failed: ${encoded.stderr}`)
  process.exit(1)
}
if (!values.keep) {
  rmSync(work, { force: true, recursive: true })
}
console.log(`${out}: ${shots.length} frames`)
