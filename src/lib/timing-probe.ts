// `?timingProbe=1` on the player page records, every animation frame, what the
// YouTube iframe reports and what the fill clock shows, and summarises it on
// window.__synboxTimingProbe. It measures how often the iframe reports time and
// how far the extrapolated clock runs from each report, to judge whether any
// display offset is justified. Off unless the flag is set.

export interface ProbeSample {
  now: number
  reported: number
  clock: number
  playing: boolean
}

export interface ProbeSummary {
  frames: number
  seconds: number
  frameMs: { median: number; p90: number }
  reportIntervalMs: { median: number; p90: number; max: number }
  // How far the fill clock had run past the newest report, in ms
  extrapolationMs: { median: number; p90: number; max: number }
  // Clock minus true media time, estimated from the next report: the clock's error
  clockErrorMs: { median: number; p10: number; p90: number }
}

const quantile = (values: number[], q: number) => {
  if (values.length === 0) {
    return Number.NaN
  }
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

const round = (value: number) => Math.round(value * 10) / 10

export const summarizeProbe = (
  samples: readonly ProbeSample[]
): ProbeSummary => {
  const playing = samples.filter((s) => s.playing)
  const frames = playing.slice(1).map((s, i) => s.now - playing[i].now)
  // A report is a frame whose reported time differs from the previous frame's
  const reports = playing.filter(
    (s, i) => i === 0 || s.reported !== playing[i - 1].reported
  )
  const intervals = reports.slice(1).map((s, i) => s.now - reports[i].now)
  const extrapolation = playing.map((s) => (s.clock - s.reported) * 1000)
  // Between two reports, true time ≈ the earlier report plus wall time elapsed;
  // the later report checks that assumption, so use both ends
  const errors: number[] = []
  for (let i = 1; i < reports.length; i += 1) {
    const a = reports[i - 1]
    const b = reports[i]
    const rate = (b.reported - a.reported) / ((b.now - a.now) / 1000)
    for (const s of playing) {
      if (s.now >= a.now && s.now < b.now) {
        const truth = a.reported + ((s.now - a.now) / 1000) * rate
        errors.push((s.clock - truth) * 1000)
      }
    }
  }
  return {
    clockErrorMs: {
      median: round(quantile(errors, 0.5)),
      p10: round(quantile(errors, 0.1)),
      p90: round(quantile(errors, 0.9)),
    },
    extrapolationMs: {
      max: round(Math.max(...extrapolation)),
      median: round(quantile(extrapolation, 0.5)),
      p90: round(quantile(extrapolation, 0.9)),
    },
    frameMs: {
      median: round(quantile(frames, 0.5)),
      p90: round(quantile(frames, 0.9)),
    },
    frames: playing.length,
    reportIntervalMs: {
      max: round(Math.max(...intervals)),
      median: round(quantile(intervals, 0.5)),
      p90: round(quantile(intervals, 0.9)),
    },
    seconds:
      playing.length > 1
        ? round((playing[playing.length - 1].now - playing[0].now) / 1000)
        : 0,
  }
}

// Read when the bundle loads: the router drops unknown query parameters before
// the player mounts. localStorage.synboxTimingProbe = '1' also turns it on.
const enabledAtLoad = (() => {
  if (typeof window === 'undefined') {
    return false
  }
  if (new URLSearchParams(window.location.search).get('timingProbe') === '1') {
    return true
  }
  try {
    return window.localStorage.getItem('synboxTimingProbe') === '1'
  } catch {
    return false
  }
})()

export const timingProbeEnabled = () => enabledAtLoad
