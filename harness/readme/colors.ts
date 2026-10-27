// The README's colour strip: one row, one card per lyric colour (the presets, then Custom), each a few characters
// part way through the karaoke wipe, sung in the preset's accent with its glow, as on the player. Colours come from
// the app's own list (src/lib/lyrics-themes.ts), so the strip can't drift from what a listener picks.
//
//   bun harness/readme/colors.ts <out.webp>

import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import {
  getCustomThemeColors,
  LYRICS_THEMES,
} from '../../src/lib/lyrics-themes'
import { closeBrowsers, open, WEB } from '../bench/engines/browser'

const [out] = process.argv.slice(2)
if (out === undefined) {
  console.error('Usage: bun harness/readme/colors.ts <out.webp>')
  process.exit(1)
}

// The song's title, "ark": sung up to two thirds, so both the accent and the unsung white show
const TEXT = '方舟で'
const SUNG = 0.64
// A hue no preset has, to show that Custom is any colour
const CUSTOM_HUE = 175
const ROW = { gap: 12, height: 150, width: 1364 }

const cards = [
  ...LYRICS_THEMES.map((theme) => ({
    accent: theme.accent,
    glow: theme.glow,
    name: theme.name,
  })),
  { ...getCustomThemeColors(CUSTOM_HUE), name: 'Custom' },
]

const card = ({ accent, glow, name }: (typeof cards)[number]) => `
<figure>
  <div class="tile"><span class="line" style="--accent:${accent};--glow:${glow}">${TEXT}</span></div>
  <figcaption>${name}</figcaption>
</figure>`

const html = `<!doctype html><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@900&family=Plus+Jakarta+Sans:wght@600&display=block&text=${encodeURIComponent(`${TEXT}${cards.map((c) => c.name).join('')}`)}" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { background: transparent; }
  #row { display: flex; gap: ${ROW.gap}px; width: ${ROW.width}px; height: ${ROW.height}px; }
  figure { flex: 1; display: flex; flex-direction: column; gap: 10px; }
  .tile { flex: 1; display: grid; place-items: center; border-radius: 18px; background: #16161a;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.06); }
  .line { font: 900 40px/1 'Noto Sans JP', sans-serif; letter-spacing: 0.02em;
    background: linear-gradient(to right, var(--accent) ${SUNG * 100}%, #f5f5f5 ${SUNG * 100}%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    filter: drop-shadow(0 0 1px rgb(0 0 0 / 0.95)) drop-shadow(0 1px 3px rgb(0 0 0 / 0.7))
      drop-shadow(0 0 10px var(--glow)); }
  figcaption { text-align: center; font: 600 15px/1 'Plus Jakarta Sans', sans-serif; color: #8b8b94; }
</style>
<div id="row">${cards.map(card).join('')}</div>`

const work = path.join(path.dirname(path.resolve(out)), '.colors')
rmSync(work, { force: true, recursive: true })
mkdirSync(work, { recursive: true })
const { page, close } = await open(WEB.surface, { scale: 2 })
await page.setContent(html, { waitUntil: 'networkidle' })
await page.evaluate(async () => {
  await document.fonts.ready
})
const png = path.join(work, 'colors.png')
await page.locator('#row').screenshot({ omitBackground: true, path: png })
await close()
await closeBrowsers()

const encoded = spawnSync('cwebp', ['-quiet', '-q', '90', png, '-o', out], {
  encoding: 'utf-8',
})
if (encoded.status !== 0) {
  console.error(`cwebp failed: ${encoded.stderr}`)
  process.exit(1)
}
console.log(`${out}: ${cards.length} colours`)
