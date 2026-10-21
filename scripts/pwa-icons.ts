// Draws the app and tab icons from the logo, renames them by content hash and points the manifest and index.html at them.
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
// SYNBOX alone, split between N and B for the two-line favicon
const CAPS = { y0: 34.6, y1: 62.2 }
const SYN = { x0: 71.7, x1: 129.6 }
const BOX = { x0: 137.2, x1: 199 }
const LOGO_HEIGHT = 99
// The wordmark grows around the bars' centre, so SYNBOX stays on their axis
const AXIS = { x: (BARS.x0 + BARS.x1) / 2, y: (BARS.y0 + BARS.y1) / 2 }

// Width of the square the logo is drawn at, which sets the bars' size: 110% leaves them 10% from each edge
const REGULAR_LOGO = 1.1
// A maskable icon must keep everything inside the central circle of 80% (radius 0.4); Android crops the rest
const MASKABLE_LOGO = 0.94
const SAFE_RADIUS = 0.4
const SAFE_GAP = 0.02
const MIN_EDGE_GAP = 0.08

// The favicons' letters keep a little of the glow, which at 16 px only blurred them into the background
const CRISP = `<svg width="0" height="0" style="position:absolute"><filter id="crisp"><feComponentTransfer><feFuncA type="linear" slope="2.5" intercept="-0.9"/></feComponentTransfer></filter></svg>`

const BACKGROUND =
  'radial-gradient(circle at 50% 50%, #3b0c26 0%, #22091a 45%, #150406 100%)'

// The app icons: the bars with SYNBOX and カラオケ over them
interface Lockup {
  kind: 'lockup'
  logo: number
  name: string
  safeZone: boolean
  size: number
}

// Tab icons: six letters on one line are a blur at 16 px, so SYN over BOX, over the same bars
interface Stacked {
  kind: 'stacked'
  name: string
  size: number
  // The share of the square BOX spans
  width: number
}

type Icon = Lockup | Stacked

const lockup = (name: string, size: number, logo = REGULAR_LOGO): Lockup => ({
  kind: 'lockup',
  logo,
  name,
  safeZone: logo === MASKABLE_LOGO,
  size,
})

const ICONS: Icon[] = [
  { kind: 'stacked', name: 'favicon-16x16', size: 16, width: 0.9 },
  { kind: 'stacked', name: 'favicon-32x32', size: 32, width: 0.84 },
  lockup('pwa-64x64', 64),
  lockup('pwa-192x192', 192),
  lockup('pwa-512x512', 512),
  lockup('apple-touch-icon-180x180', 180),
  lockup('maskable-icon-512x512', 512, MASKABLE_LOGO),
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
  const kanaStart = svg.indexOf('<g mask=', wordmarkStart + 1)
  if (kanaStart === -1) {
    throw new Error(
      'The logo SVG changed shape: expected SYNBOX, then カラオケ'
    )
  }
  const head = svg.slice(0, defs + '</defs>'.length)
  return {
    bars: svg.slice(0, wordmarkStart) + svg.slice(end),
    synbox: head + svg.slice(wordmarkStart, kanaStart) + svg.slice(end),
    wordmark: head + svg.slice(wordmarkStart),
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

const check = (icon: Lockup, shape: ReturnType<typeof layout>) => {
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

const place = (
  src: string,
  { left, top, width }: { left: number; top: number; width: number },
  size: number,
  extra = ''
) =>
  `<img src="${src}" style="position:absolute;left:${left * size}px;top:${top * size}px;width:${width * size}px;${extra}">`

const drawLockup = (icon: Lockup, scale: number) => {
  const shape = layout(icon.logo, scale)
  check(icon, shape)
  return (
    place('bars.svg', shape.bars, icon.size) +
    place('wordmark.svg', shape.wordmark, icon.size)
  )
}

const drawStacked = (icon: Stacked) => {
  if (icon.width > 1 - 2 * 0.04) {
    throw new Error(`${icon.name}: the letters come within 4% of the edge`)
  }
  const unit = icon.width / (BOX.x1 - BOX.x0)
  const capHeight = CAPS.y1 - CAPS.y0
  const lineGap = capHeight * 0.22
  const top = 0.5 - ((capHeight * 2 + lineGap) * unit) / 2
  // Each line is SYNBOX drawn whole and clipped to its three letters, centred on the square
  const line = (letters: typeof SYN, row: number) => {
    const pad = 2
    const left = 0.5 - ((letters.x0 + letters.x1) / 2) * unit
    const capTop = top + row * (capHeight + lineGap) * unit
    const clip = [
      CAPS.y0 - pad,
      LOGO_WIDTH - letters.x1 - pad,
      LOGO_HEIGHT - CAPS.y1 - pad,
      letters.x0 - pad,
    ]
      .map((inset) => `${inset * unit * icon.size}px`)
      .join(' ')
    return place(
      'synbox.svg',
      { left, top: capTop - CAPS.y0 * unit, width: LOGO_WIDTH * unit },
      icon.size,
      `clip-path:inset(${clip});filter:url(#crisp)`
    )
  }
  return (
    place('bars.svg', layout(REGULAR_LOGO, 1).bars, icon.size) +
    line(SYN, 0) +
    line(BOX, 1)
  )
}

const render = (
  chrome: string,
  work: string,
  icon: Icon,
  scale: number,
  out: string
) => {
  const { size } = icon
  const art =
    icon.kind === 'lockup' ? drawLockup(icon, scale) : drawStacked(icon)
  const page = path.join(work, `${icon.name}.html`)
  writeFileSync(
    page,
    // Headless Chrome lays out wider than the screenshot, so the square is a box of its own rather than the page
    `<!doctype html><body style="margin:0">${CRISP}<div style="position:relative;overflow:hidden;width:${size}px;height:${size}px;background:${BACKGROUND}">${art}</div></body>`
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
writeFileSync(path.join(work, 'synbox.svg'), parts.synbox)
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
