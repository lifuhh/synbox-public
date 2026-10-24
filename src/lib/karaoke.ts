import type { KaraokeDocLine } from '@/types'

// When one mora's share of the width fills: a ramp in seconds
export interface FillSpan {
  start: number
  end: number
  // Share of the part's width: the characters this mora is written with
  weight: number
}

// Each mora wipes across its own length, up to the next mora's onset, so the
// fill runs continuously through a phrase instead of dashing and freezing.
// It starts FILL_LEAD early so the edge is not behind the voice, and its
// length is held between FILL_MIN and FILL_MAX: a very short mora doesn't
// flash, and a held note (or one that absorbed a rest) doesn't crawl.
// Measured on M5_foAv6AqQ (942 morae): no freeze between contiguous morae,
// a mora half-lit a median 30 ms after its onset (p90 80 ms).
export const FILL_LEAD = 0.06
export const FILL_MIN = 0.08
export const FILL_MAX = 0.5

// Fill p in [0, 1] for one part: each mora fills its weighted share linearly
// over its ramp. A rest between ramps holds the reached share.
export const fillProgress = (spans: readonly FillSpan[], time: number) => {
  let total = 0
  let filled = 0
  for (const { start, end, weight } of spans) {
    total += weight
    if (time >= end) {
      filled += weight
    } else if (time > start) {
      filled += (weight * (time - start)) / (end - start)
    }
  }
  return total > 0 ? filled / total : 0
}

// Per token, each mora's ramp. A Latin word fills across its whole span.
const lineRamps = (line: KaraokeDocLine) => {
  const morae = line.tokens.flatMap((token, t) =>
    token.morae.map((mora) => ({ latin: token.is_latin, mora, t }))
  )
  const ramps: { start: number; end: number }[][] = line.tokens.map(() => [])
  for (const [i, { latin, mora, t }] of morae.entries()) {
    if (latin) {
      ramps[t].push({ end: mora.end, start: mora.start })
      continue
    }
    const next = morae[i + 1]?.mora.start ?? mora.end
    const sung = Math.min(mora.end, Math.max(next, mora.start)) - mora.start
    const length = Math.min(Math.max(sung, FILL_MIN), FILL_MAX)
    ramps[t].push({
      end: mora.start - FILL_LEAD + length,
      start: mora.start - FILL_LEAD,
    })
  }
  return ramps
}

const SMALL_KANA = new Set('ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ')
const STANDALONE = new Set('ッっンんー')

// Characters per mora in kana text: small kana join the mora before them
// (きょ is one mora written with two characters), as the backend splits them
export const moraCharCounts = (text: string) => {
  const counts: number[] = []
  let previous = ''
  for (const char of text) {
    if (
      SMALL_KANA.has(char) &&
      counts.length > 0 &&
      !STANDALONE.has(previous)
    ) {
      counts[counts.length - 1] += 1
    } else {
      counts.push(1)
    }
    previous = char
  }
  return counts
}

// One part per ruby segment, each with its own morae: a kanji's base and its
// furigana fill together from that kanji's morae (残 from の and こ, then し),
// and each mora's width is the characters it is written with. When the reading
// cannot be matched to the morae, every part shares the token's morae.
export interface FillPart {
  base: string
  rt: string
  spans: FillSpan[]
}

// Tokens without morae (punctuation, spaces, ♪) get a zero-length span at the
// end of the previous timed token, or at the line start, so they snap to
// filled once the text before them has filled.
export const tokenFillParts = (line: KaraokeDocLine): FillPart[][] => {
  const ramps = lineRamps(line)
  let previousEnd = line.start
  return line.tokens.map((token, t) => {
    if (token.morae.length === 0) {
      return [
        {
          base: token.surface,
          rt: '',
          spans: [{ end: previousEnd, start: previousEnd, weight: 1 }],
        },
      ]
    }
    previousEnd = Math.max(...ramps[t].map(({ end }) => end))
    const segments =
      token.is_latin || token.ruby.length === 0
        ? [{ base: token.surface, rt: '' }]
        : token.ruby
    const counts = segments.map(({ base, rt }) => moraCharCounts(rt || base))
    const matched =
      !token.is_latin &&
      counts.reduce((sum, c) => sum + c.length, 0) === token.morae.length
    if (!matched) {
      const spans = ramps[t].map((ramp) => ({ ...ramp, weight: 1 }))
      return segments.map(({ base, rt }) => ({ base, rt, spans }))
    }
    const firstMora = counts.map((_, i) =>
      counts.slice(0, i).reduce((sum, c) => sum + c.length, 0)
    )
    return segments.map(({ base, rt }, index) => ({
      base,
      rt,
      spans: counts[index].map((weight, k) => ({
        ...ramps[t][firstMora[index] + k],
        weight,
      })),
    }))
  })
}

// The romaji line, one part per sung word (as the backend's romaji_line joins
// them), so it wipes on the same clock as the Japanese, mora by mora
export const romajiFillParts = (line: KaraokeDocLine): FillPart[] => {
  const ramps = lineRamps(line)
  const parts: FillPart[] = []
  for (const [t, token] of line.tokens.entries()) {
    if (token.morae.length === 0) {
      continue
    }
    const base = token.is_latin
      ? token.surface
      : token.morae.map(({ romaji }) => romaji).join('')
    const spans = token.morae.map(({ romaji }, k) => ({
      ...ramps[t][k],
      weight: Math.max(1, romaji.length),
    }))
    const previous = parts.at(-1)
    // A verb ending fills as part of its word, as the plain romaji line writes it (kawatteta)
    if (token.joins === true && previous !== undefined) {
      previous.base += base
      previous.spans.push(...spans)
    } else {
      parts.push({ base, rt: '', spans })
    }
  }
  return parts
}

// A line shows this long before its first mora (unfilled, to be read before
// the wipe), unless the line before it is still being sung
export const LINE_LEAD_IN = 0.5

// The aligner ends a held last note when its vowel stops scoring, often well
// before the singer lets go, and a line that vanishes reads as "stop singing".
// So a finished line stays (filled) until the next one takes over. Only before
// an instrumental break (a gap of INSTRUMENTAL_GAP or more, or the song's end)
// does it clear, LINE_HOLD after its last mora.
export const INSTRUMENTAL_GAP = 4
export const LINE_HOLD = 2

const lineRelease = (
  lines: readonly Pick<KaraokeDocLine, 'start' | 'end'>[],
  index: number
) => {
  const { end } = lines[index]
  const next = lines[index + 1]
  return next === undefined || next.start - end >= INSTRUMENTAL_GAP
    ? end + LINE_HOLD
    : Infinity
}

export const currentLineIndex = (
  lines: readonly Pick<KaraokeDocLine, 'start' | 'end'>[],
  time: number,
  leadIn = LINE_LEAD_IN
) => {
  let index = -1
  for (const [i, line] of lines.entries()) {
    if (line.start - leadIn <= time) {
      index = i
    }
  }
  if (index < 0) {
    return -1
  }
  const previous = lines[index - 1]
  if (
    time < lines[index].start &&
    previous !== undefined &&
    time < previous.end
  ) {
    return index - 1
  }
  return time < lineRelease(lines, index) ? index : -1
}

// The karaoke two-row layout: two fixed rows, the sung line in one and the
// next line waiting in the other. A finished line's row takes the line after
// next, so the line being sung never changes rows and the eye never jumps.
// Each passage after an instrumental break starts again in the top row
export interface TwoLineView {
  active: number
  // Line index in the top and the bottom row, -1 for an empty row
  rows: readonly [number, number]
}

const NO_LINES: TwoLineView = { active: -1, rows: [-1, -1] }

// When a line takes over from the one before it: its lead-in, or the previous line's end if that comes later
// (but never after the line itself starts). currentLineIndex switches at the same moment
const takesOverAt = (
  lines: readonly Pick<KaraokeDocLine, 'start' | 'end'>[],
  index: number,
  leadIn: number
) =>
  Math.max(
    lines[index].start - leadIn,
    Math.min(lines[index].start, lines[index - 1].end)
  )

// A finished line stays in its row this long after the next takes over, so it doesn't vanish the moment it ends;
// not when the line now sung is too short to give the one after it time to be read
export const FINISHED_HOLD = 0.5
export const HOLD_MIN_LINE = 1

const startsPassage = (
  lines: readonly Pick<KaraokeDocLine, 'start' | 'end'>[],
  index: number
) =>
  index === 0 || lines[index].start - lines[index - 1].end >= INSTRUMENTAL_GAP

export const twoLineView = (
  lines: readonly Pick<KaraokeDocLine, 'start' | 'end'>[],
  time: number,
  leadIn = LINE_LEAD_IN
): TwoLineView => {
  const active = currentLineIndex(lines, time, leadIn)
  if (active < 0) {
    return NO_LINES
  }
  let first = active
  while (!startsPassage(lines, first)) {
    first -= 1
  }
  const next =
    active + 1 < lines.length && !startsPassage(lines, active + 1)
      ? active + 1
      : -1
  const holding =
    active > first &&
    lines[active].end - lines[active].start >= HOLD_MIN_LINE &&
    time < takesOverAt(lines, active, leadIn) + FINISHED_HOLD
  // The other row is where the line before finished; it keeps that line through the hold
  const other = holding ? active - 1 : next
  return {
    active,
    rows: (active - first) % 2 === 0 ? [active, other] : [other, active],
  }
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
