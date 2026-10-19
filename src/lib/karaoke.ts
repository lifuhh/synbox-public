import type { KaraokeDocLine } from '@/types'

export interface FillSpan {
  start: number
  end: number
}

// Fill p in [0, 1] for one token: every mora is an equal share of the token's
// width and fills linearly inside its own [start, end]. A gap between morae
// holds at the share already reached.
export const fillProgress = (spans: readonly FillSpan[], time: number) => {
  if (spans.length === 0) {
    return 0
  }
  let filled = 0
  for (const { start, end } of spans) {
    if (time >= end) {
      filled += 1
    } else if (time > start) {
      filled += (time - start) / (end - start)
    }
  }
  return filled / spans.length
}

// One span list per token. Tokens without morae (punctuation, spaces, ♪) get a
// zero-length span at the end of the previous timed token, or at the line
// start, so they snap to filled once the text before them has filled.
export const tokenFillSpans = (line: KaraokeDocLine): FillSpan[][] => {
  let previousEnd = line.start
  return line.tokens.map((token) => {
    if (token.morae.length === 0) {
      return [{ end: previousEnd, start: previousEnd }]
    }
    previousEnd = Math.max(...token.morae.map(({ end }) => end))
    return token.morae.map(({ start, end }) => ({ end, start }))
  })
}

export interface PlaybackClock {
  // Last time the player reported, and the performance.now() it was seen at
  mediaTime: number
  anchoredAt: number
  time: number
}

export interface PlaybackSample {
  mediaTime: number
  now: number
  playing: boolean
  rate: number
}

// The YouTube player's currentTime moves in steps; between steps the clock
// runs on performance.now(), but never more than this far past the last
// report, so buffering (reported as playing) freezes the fill quickly
export const MAX_EXTRAPOLATION = 0.5
// Falling further behind the smoothed time than this is a seek or the end of
// a stall: jump. Smaller backward steps are report jitter: hold still instead.
export const BACKWARD_RESYNC = 0.25

export const advancePlaybackClock = (
  clock: PlaybackClock | null,
  sample: PlaybackSample
): PlaybackClock => {
  if (clock === null || !sample.playing) {
    return {
      anchoredAt: sample.now,
      mediaTime: sample.mediaTime,
      time: sample.mediaTime,
    }
  }
  const reported = sample.mediaTime !== clock.mediaTime
  const anchoredAt = reported ? sample.now : clock.anchoredAt
  const elapsed = ((sample.now - anchoredAt) / 1000) * sample.rate
  const predicted =
    sample.mediaTime + Math.min(Math.max(elapsed, 0), MAX_EXTRAPOLATION)
  const time =
    predicted < clock.time - BACKWARD_RESYNC
      ? predicted
      : Math.max(clock.time, predicted)
  return { anchoredAt, mediaTime: sample.mediaTime, time }
}

// karaoke.json holds the newest generation, while the song may show (or
// preview) an older lyrics version: timing applies only to the same lines.
export const karaokeMatchesLyrics = (
  lines: readonly Pick<KaraokeDocLine, 'text'>[],
  plainLyrics: string | undefined
) => {
  let shown: unknown
  try {
    shown = JSON.parse(plainLyrics ?? '')
  } catch {
    return false
  }
  return (
    Array.isArray(shown) &&
    shown.length === lines.length &&
    lines.every((line, i) => line.text === shown[i])
  )
}
