// Draws the app and tab icons and the iPhone launch images from the logo, renames them by content hash and points the
// manifest and index.html at them.
//   bun run icons                                   regenerate public/ and the references
//   bun run icons --only launch                     only the pictures whose name starts with "launch"
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
// The tab icon has no square behind it, so the lockup grows until SYNBOX spans 98% of the box and the bars' ends
// run past its edges
const TAB_LOGO = 1.42

const BACKGROUND =
  'radial-gradient(circle at 50% 50%, #3b0c26 0%, #22091a 45%, #150406 100%)'

// Every icon is the same picture, the bars with SYNBOX and カラオケ over them, drawn at its own size
interface Icon {
  background: boolean
  logo: number
  name: string
  safeZone: boolean
  size: number
}

const square = (name: string, size: number, logo = REGULAR_LOGO): Icon => ({
  background: true,
  logo,
  name,
  safeZone: logo === MASKABLE_LOGO,
  size,
})

const tab = (name: string, size: number): Icon => ({
  background: false,
  logo: TAB_LOGO,
  name,
  safeZone: false,
  size,
})

const ICONS: Icon[] = [
  tab('favicon-16x16', 16),
  tab('favicon-32x32', 32),
  square('pwa-64x64', 64),
  // The manifest's shortcuts: Android draws their icons at 96px
  square('pwa-96x96', 96),
  square('pwa-192x192', 192),
  square('pwa-512x512', 512),
  square('apple-touch-icon-180x180', 180),
  square('maskable-icon-512x512', 512, MASKABLE_LOGO),
]

// An installed iPhone app shows a launch image while it starts, and only one whose media query names the screen's
// exact size in points and its pixel ratio; with none it shows a blank screen. One per screen of the iPhones that
// run iOS 26 and 27 (iPhone 11 and SE 2 onwards), upright. Sizes: pwa-asset-generator's device list
// (src/config/apple-fallback-data.json, itself read from Apple's Human Interface Guidelines › Layout), as of
// 2026-11-16. A new screen size needs a row
interface Screen {
  devices: string
  height: number
  ratio: number
  width: number
}

const SCREENS: Screen[] = [
  { devices: '17 Pro Max, 16 Pro Max', height: 956, ratio: 3, width: 440 },
  {
    devices: '16 Plus, 15 Pro Max, 15 Plus, 14 Pro Max',
    height: 932,
    ratio: 3,
    width: 430,
  },
  {
    devices: '14 Plus, 13 Pro Max, 12 Pro Max',
    height: 926,
    ratio: 3,
    width: 428,
  },
  { devices: 'Air', height: 912, ratio: 3, width: 420 },
  { devices: '11 Pro Max', height: 896, ratio: 3, width: 414 },
  { devices: '11', height: 896, ratio: 2, width: 414 },
  { devices: '17 Pro, 17, 16 Pro', height: 874, ratio: 3, width: 402 },
  { devices: '16, 15 Pro, 15, 14 Pro', height: 852, ratio: 3, width: 393 },
  {
    devices: '16e, 14, 13 Pro, 13, 12 Pro, 12',
    height: 844,
    ratio: 3,
    width: 390,
  },
  // The minis have fewer pixels (1080×2340) but lay out, and pick a launch image, as this screen
  { devices: '13 mini, 12 mini, 11 Pro', height: 812, ratio: 3, width: 375 },
  { devices: 'SE 2, SE 3', height: 667, ratio: 2, width: 375 },
]

// The page's colour before the app draws (the manifest's background_color), so the launch image hands over to it
const LAUNCH_BACKGROUND = '#0e0c0c'
// The square the logo is drawn in, as a share of the screen's width: the bars span about a third of the screen
const LAUNCH_LOGO = 0.4
const LAUNCH_DIR = 'launch'
const LAUNCH_FILE = /^launch-\d+x\d+(-[0-9a-f]{8})?\.png$/u
const LAUNCH_LINKS =
  /( *)<!-- launch-images:start[^>]*-->[\s\S]*?<!-- launch-images:end -->/u

const launchName = ({ height, ratio, width }: Screen) =>
  `launch-${width * ratio}x${height * ratio}`

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
  if (edgeGap < (icon.background ? MIN_EDGE_GAP : 0)) {
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

interface Picture {
  background: string | undefined
  height: number
  // The square the logo is laid out in, in pixels, centred in the picture
  logoBox: number
  name: string
  width: number
}

const draw = (
  chrome: string,
  work: string,
  picture: Picture,
  shape: ReturnType<typeof layout>,
  out: string
) => {
  const { background, height, logoBox, width } = picture
  const x = (width - logoBox) / 2
  const y = (height - logoBox) / 2
  const place = (src: string, part: typeof shape.bars) =>
    `<img src="${src}" style="position:absolute;left:${x + part.left * logoBox}px;top:${y + part.top * logoBox}px;width:${part.width * logoBox}px">`
  const page = path.join(work, `${picture.name}.html`)
  writeFileSync(
    page,
    // Headless Chrome lays out wider than the screenshot, so the picture is a box of its own rather than the page
    `<!doctype html><body style="margin:0"><div style="position:relative;overflow:hidden;width:${width}px;height:${height}px${background === undefined ? '' : `;background:${background}`}">${place('bars.svg', shape.bars)}${place('wordmark.svg', shape.wordmark)}</div></body>`
  )
  execFileSync(
    chrome,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      ...(background === undefined
        ? ['--default-background-color=00000000']
        : []),
      '--force-device-scale-factor=1',
      `--window-size=${width},${height}`,
      `--screenshot=${out}`,
      `file://${page}`,
    ],
    { stdio: 'ignore' }
  )
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
  draw(
    chrome,
    work,
    {
      background: icon.background ? BACKGROUND : undefined,
      height: icon.size,
      logoBox: icon.size,
      name: icon.name,
      width: icon.size,
    },
    shape,
    out
  )
}

const renderLaunch = (
  chrome: string,
  work: string,
  screen: Screen,
  scale: number,
  out: string
) => {
  const width = screen.width * screen.ratio
  draw(
    chrome,
    work,
    {
      background: LAUNCH_BACKGROUND,
      height: screen.height * screen.ratio,
      logoBox: Math.round(width * LAUNCH_LOGO),
      name: launchName(screen),
      width,
    },
    layout(REGULAR_LOGO, scale),
    out
  )
}

// Writes each launch image under a name with its content hash and rewrites index.html's block of links to them
const publishLaunch = (
  chrome: string,
  work: string,
  screens: Screen[],
  scale: number
) => {
  const dir = path.join(publicDir, LAUNCH_DIR)
  mkdirSync(dir, { recursive: true })
  for (const entry of readdirSync(dir)) {
    if (LAUNCH_FILE.test(entry)) {
      rmSync(path.join(dir, entry))
    }
  }
  const links = screens.map((screen) => {
    const drawn = path.join(work, `${launchName(screen)}.png`)
    renderLaunch(chrome, work, screen, scale, drawn)
    const png = readFileSync(drawn)
    const hash = createHash('sha256').update(png).digest('hex').slice(0, 8)
    const file = `${launchName(screen)}-${hash}.png`
    writeFileSync(path.join(dir, file), png)
    console.log(`${LAUNCH_DIR}/${file}`)
    return [
      `<!-- iPhone ${screen.devices} -->`,
      '<link',
      '  rel="apple-touch-startup-image"',
      `  media="screen and (device-width: ${screen.width}px) and (device-height: ${screen.height}px) and (-webkit-device-pixel-ratio: ${screen.ratio}) and (orientation: portrait)"`,
      `  href="/${LAUNCH_DIR}/${file}" />`,
    ]
  })
  const html = path.join(root, 'index.html')
  const text = readFileSync(html, 'utf-8')
  const block = LAUNCH_LINKS.exec(text)
  if (block === null) {
    throw new Error('index.html: no launch-images:start … launch-images:end')
  }
  const [, indent] = block
  const lines = [
    '<!-- launch-images:start (written by scripts/pwa-icons.ts: edit SCREENS there) -->',
    ...links.flat(),
    '<!-- launch-images:end -->',
  ]
  writeFileSync(
    html,
    text.replace(
      LAUNCH_LINKS,
      // A function, so a `$` in the block is never read as a replacement pattern
      () => lines.map((line) => `${indent}${line}`).join('\n')
    )
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
    // Draw only the pictures whose name starts with this ("launch", "pwa-96"); the rest keep their files
    only: { default: '', type: 'string' },
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
  const { only, preview } = values
  const icons = ICONS.filter(({ name }) => name.startsWith(only))
  // Launch images are published together: index.html's block lists every one
  const screens = 'launch'.startsWith(only) ? SCREENS : []
  if (preview === undefined) {
    for (const icon of icons) {
      publish(chrome, work, icon, scale)
    }
    if (screens.length > 0) {
      publishLaunch(chrome, work, screens, scale)
    }
  } else {
    mkdirSync(preview, { recursive: true })
    for (const icon of icons) {
      render(chrome, work, icon, scale, path.join(preview, `${icon.name}.png`))
    }
    for (const screen of screens) {
      renderLaunch(
        chrome,
        work,
        screen,
        scale,
        path.join(preview, `${launchName(screen)}.png`)
      )
    }
  }
} finally {
  rmSync(work, { force: true, recursive: true })
}
