// Draws the app icons from the logo, renames them by content hash and points the manifest and index.html at them.
//   bun run icons                                   regenerate public/ and the references
//   bun run icons --preview <dir> [--wordmark 0.8]   only write the PNGs to <dir>, to compare sizes
// Needs Google Chrome; set CHROME to its binary if it is not in the usual place.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

const root = path.resolve(import.meta.dirname, '..')
const publicDir = path.join(root, 'public')
const referrers = ['vite.config.ts', 'index.html'].map((file) =>
  path.join(root, file)
)

// The logo's parts in its own viewBox units, measured from the drawn pixels; the wordmark's box leaves out its glow
const LOGO_WIDTH = 270
const BARS = { x0: 37.5, x1: 232.7, y0: 8, y1: 91 }
const WORDMARK = { x0: 71.7, x1: 199, y0: 34.6, y1: 80.3 }
// The wordmark grows around the bars' centre, so SYNBOX stays on their axis
const AXIS = { x: (BARS.x0 + BARS.x1) / 2, y: (BARS.y0 + BARS.y1) / 2 }

// Width of the square the logo is drawn at, which sets the bars' size: 110% leaves them 10% from each edge
const REGULAR_LOGO = 1.1
// A maskable icon must keep everything inside the central circle of 80% (radius 0.4); Android crops the rest
const MASKABLE_LOGO = 0.94
const SAFE_RADIUS = 0.4
const SAFE_GAP = 0.02
const MIN_EDGE_GAP = 0.08

const BACKGROUND =
  'radial-gradient(circle at 50% 50%, #3b0c26 0%, #22091a 45%, #150406 100%)'

interface Icon {
  logo: number
  name: string
  safeZone: boolean
  size: number
}

const ICONS: Icon[] = [
  { logo: REGULAR_LOGO, name: 'pwa-192x192', safeZone: false, size: 192 },
  { logo: REGULAR_LOGO, name: 'pwa-512x512', safeZone: false, size: 512 },
  {
    logo: REGULAR_LOGO,
    name: 'apple-touch-icon-180x180',
    safeZone: false,
    size: 180,
  },
  {
    logo: MASKABLE_LOGO,
    name: 'maskable-icon-512x512',
    safeZone: true,
    size: 512,
  },
]

const splitLogo = (svg: string) => {
  const defs = svg.indexOf('</defs>')
  const wordmarkStart = svg.indexOf('<g mask=')
  const end = svg.lastIndexOf('</svg>')
  if (defs === -1 || end === -1 || wordmarkStart < defs) {
    throw new Error(
      'The logo SVG changed shape: expected <defs>, then the bars, then the masked wordmark images'
    )
  }
  return {
    bars: svg.slice(0, wordmarkStart) + svg.slice(end),
    wordmark: svg.slice(0, defs + '</defs>'.length) + svg.slice(wordmarkStart),
  }
}

// Positions as shares of the square, with the bars at their old size and the wordmark scaled by `scale`
const layout = (logo: number, scale: number) => {
  const unit = logo / LOGO_WIDTH
  const top = Math.min(BARS.y0 - AXIS.y, (WORDMARK.y0 - AXIS.y) * scale)
  const bottom = Math.max(BARS.y1 - AXIS.y, (WORDMARK.y1 - AXIS.y) * scale)
  // Centres the whole lockup, bars and wordmark together
  const axisY = 0.5 - ((top + bottom) / 2) * unit
  const place = (factor: number) => ({
    left: 0.5 - AXIS.x * unit * factor,
    top: axisY - AXIS.y * unit * factor,
    width: logo * factor,
  })
  const corners = [WORDMARK.x0, WORDMARK.x1].flatMap((x) =>
    [WORDMARK.y0, WORDMARK.y1].map((y) => ({
      x: (x - AXIS.x) * unit * scale,
      y: axisY - 0.5 + (y - AXIS.y) * unit * scale,
    }))
  )
  return {
    bars: place(1),
    barsHalfWidth: ((BARS.x1 - BARS.x0) / 2) * unit,
    corners,
    wordmark: place(scale),
  }
}

const check = (icon: Icon, shape: ReturnType<typeof layout>) => {
  const edgeGap = 0.5 - Math.max(...shape.corners.map(({ x }) => Math.abs(x)))
  if (edgeGap < MIN_EDGE_GAP) {
    throw new Error(
      `${icon.name}: the wordmark comes within ${edgeGap.toFixed(3)} of the edge`
    )
  }
  if (!icon.safeZone) {
    return
  }
  const reach = Math.max(
    shape.barsHalfWidth,
    ...shape.corners.map(({ x, y }) => Math.hypot(x, y))
  )
  if (reach > SAFE_RADIUS - SAFE_GAP) {
    throw new Error(
      `${icon.name}: reaches ${reach.toFixed(3)} from the centre, past the maskable safe zone`
    )
  }
}

const findChrome = () => {
  const candidates = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]
  const found = candidates.find(
    (file): file is string => file !== undefined && existsSync(file)
  )
  if (found === undefined) {
    throw new Error('Google Chrome not found; set CHROME to its binary')
  }
  return found
}

const render = (
  chrome: string,
  work: string,
  icon: Icon,
  scale: number,
  out: string
) => {
  const shape = layout(icon.logo, scale)
  check(icon, shape)
  const { size } = icon
  const style = ({ left, top, width }: typeof shape.bars) =>
    `position:absolute;left:${left * size}px;top:${top * size}px;width:${width * size}px`
  const page = path.join(work, `${icon.name}.html`)
  writeFileSync(
    page,
    // Headless Chrome lays out wider than the screenshot, so the square is a box of its own rather than the page
    `<!doctype html><body style="margin:0"><div style="position:relative;overflow:hidden;width:${size}px;height:${size}px;background:${BACKGROUND}">` +
      `<img src="bars.svg" style="${style(shape.bars)}"><img src="wordmark.svg" style="${style(shape.wordmark)}"></div></body>`
  )
  execFileSync(
    chrome,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${size},${size}`,
      `--screenshot=${out}`,
      `file://${page}`,
    ],
    { stdio: 'ignore' }
  )
}

// Writes the icon under a name with its content hash and points the manifest and index.html at it; a new name
// makes browsers, the service worker and Android's installed app fetch the new picture
const publish = (chrome: string, work: string, icon: Icon, scale: number) => {
  const drawn = path.join(work, `${icon.name}.png`)
  render(chrome, work, icon, scale, drawn)
  const png = readFileSync(drawn)
  const hash = createHash('sha256').update(png).digest('hex').slice(0, 8)
  const file = `${icon.name}-${hash}.png`
  const old = new RegExp(`^${icon.name}(-[0-9a-f]{8})?\\.png$`, 'u')
  for (const entry of readdirSync(publicDir)) {
    if (old.test(entry)) {
      rmSync(path.join(publicDir, entry))
    }
  }
  writeFileSync(path.join(publicDir, file), png)
  const reference = new RegExp(`${icon.name}(-[0-9a-f]{8})?\\.png`, 'gu')
  let found = false
  for (const referrer of referrers) {
    const text = readFileSync(referrer, 'utf-8')
    if (text.match(reference) !== null) {
      found = true
      writeFileSync(referrer, text.replaceAll(reference, file))
    }
  }
  if (!found) {
    throw new Error(`${icon.name}: no reference in ${referrers.join(', ')}`)
  }
  console.log(file)
}

const { values } = parseArgs({
  options: {
    preview: { type: 'string' },
    // The share of the regular icon SYNBOX spans; the maskable one keeps the same proportion to the bars
    wordmark: { default: '0.76', type: 'string' },
  },
})
const scale =
  Number(values.wordmark) /
  (((WORDMARK.x1 - WORDMARK.x0) / LOGO_WIDTH) * REGULAR_LOGO)

const chrome = findChrome()
const work = mkdtempSync(path.join(tmpdir(), 'pwa-icons-'))
const parts = splitLogo(
  readFileSync(
    path.join(publicDir, 'assets/icons/Synbox_logo_dark_1.svg'),
    'utf-8'
  )
)
writeFileSync(path.join(work, 'bars.svg'), parts.bars)
writeFileSync(path.join(work, 'wordmark.svg'), parts.wordmark)

try {
  const { preview } = values
  for (const icon of ICONS) {
    if (preview === undefined) {
      publish(chrome, work, icon, scale)
    } else {
      mkdirSync(preview, { recursive: true })
      render(chrome, work, icon, scale, path.join(preview, `${icon.name}.png`))
    }
  }
} finally {
  rmSync(work, { force: true, recursive: true })
}
