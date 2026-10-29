// How far the lyrics' fill clock (before lyricsLead) runs from the YouTube iframe's own <video>.currentTime, read
// on one timeline in both frames. Read-only. Use it before retuning stage-lyrics.tsx › LYRICS_LEAD_SEC: the lead
// should cover only what this and the paint leave behind.
//
//   bun harness/clock-lag.ts <videoId> [--view web|pwa-portrait] [--origin https://synbox.io] [--seconds 25]
//
// Prints the median and spread of video time minus the fill clock and minus the raw reported time, in ms.
// Headless and silenced (engines/browser.ts › open). Not measured here: audio output latency (speakers, Bluetooth)
// and the display's own delay; those need a real device.

import { parseArgs } from 'node:util'

import { mark, open, PWA_PORTRAIT, WEB } from './bench/engines/browser'

interface ProbeSample {
  now: number
  reported: number
  clock: number
  playing: boolean
}

// [epoch ms, video.currentTime, playing]
type VideoSample = [number, number, boolean]

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    origin: { default: 'https://synbox.io', type: 'string' },
    seconds: { default: '25', type: 'string' },
    view: { default: 'web', type: 'string' },
  },
})
const [videoId] = positionals
if (videoId === undefined) {
  console.error('usage: bun harness/clock-lag.ts <videoId> [--view web|pwa-portrait] [--origin URL] [--seconds N]')
  process.exit(1)
}
const surface = values.view === 'pwa-portrait' ? PWA_PORTRAIT : WEB

const quantile = (xs: number[], q: number) => {
  const sorted = xs.toSorted((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN
}
const describe = (xs: number[]) =>
  `n=${xs.length} p10=${quantile(xs, 0.1).toFixed(0)} p50=${quantile(xs, 0.5).toFixed(0)} p90=${quantile(xs, 0.9).toFixed(0)}`

const { page } = await open(surface, { lookup: 'live' })
await page.goto(`${values.origin}/v/${videoId}?timingProbe=1`, { waitUntil: 'commit' })
await mark(page, 'player-iframe', 30_000)
await mark(page, 'phase-playing', 60_000)
const frame = page.frames().find((f) => /youtube(?:-nocookie)?\.com\/embed/u.test(f.url()))
if (frame === undefined) {
  throw new Error('no YouTube iframe')
}
await frame.waitForFunction(() => document.querySelector('video') !== null)
await frame.evaluate(() => {
  const video = document.querySelector('video')
  const out: [number, number, boolean][] = []
  Reflect.set(window, '__clockLag', out)
  const tick = () => {
    if (video) {
      out.push([performance.timeOrigin + performance.now(), video.currentTime, !video.paused])
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
const parentOrigin = await page.evaluate(() => performance.timeOrigin)
const from = await page.evaluate(() => performance.now() + 1000)
await page.waitForTimeout(Number(values.seconds) * 1000)
const video: VideoSample[] = await frame.evaluate(() => Reflect.get(window, '__clockLag'))
const samples: ProbeSample[] = await page.evaluate(
  () => Reflect.get(Reflect.get(window, '__synboxTimingProbe'), 'samples')
)

const clockLag: number[] = []
const reportedLag: number[] = []
let j = 0
for (const s of samples) {
  if (!s.playing || s.now < from) {
    continue
  }
  const t = parentOrigin + s.now
  while (j + 1 < video.length && video[j + 1][0] < t) {
    j += 1
  }
  const a = video[j]
  const b = video[j + 1]
  // Only between two playing reads of a running clock (no seek, stall or loop between them)
  if (a === undefined || b === undefined || a[0] > t || !a[2] || !b[2] || b[1] < a[1] || b[1] - a[1] > 0.2) {
    continue
  }
  const v = a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0])
  clockLag.push((v - s.clock) * 1000)
  reportedLag.push((v - s.reported) * 1000)
}
console.log(`${values.view} ${videoId}, ${values.seconds} s of playback`)
console.log(`  video - fill clock (ms): ${describe(clockLag)}`)
console.log(`  video - reported (ms):   ${describe(reportedLag)}`)
// Closing the context can wait on the YouTube iframe for minutes; nothing is left to save
process.exit(clockLag.length > 0 ? 0 : 2)
