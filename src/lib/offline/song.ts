import { toRomaji } from 'wanakana'

import type { RubySegment } from '@/lib/furigana'
import { parseRubyHtml } from '@/lib/furigana'
import type { TimedLyrics } from '@/lib/lyrics-document'
import { translationSpans } from '@/lib/translation-spans'
import type { KaraokeDoc, KaraokeDocLine } from '@/types'

type Language = 'en' | 'zh'

// One sung line as the reader shows it: the Japanese with its furigana, then romaji and both translations
export interface OfflineLine {
  ruby: RubySegment[]
  romaji: string
  // The translation shown after this line: its span's, on the span's last line, '' on the lines before it
  en: string
  zh: string
  // The next line is in the same translation span (up to three short lines share one translation). Missing on
  // songs saved before spans: each line is then its own
  continues?: Record<Language, boolean>
  // A pause of STANZA_GAP_SEC or more before it, so the reader starts a new paragraph
  stanza: boolean
  // When it is sung, in seconds: the karaoke timing's when it matches the lyrics, else the lyrics row's
  start: number
  end: number
  // Each mora's timing, for the karaoke fill; null when the song's timing doesn't match these lyrics
  karaoke: KaraokeDocLine | null
}

// Bumped when the saved shape changes; a sync fetches every song saved under an older one again. 3 added
// translation spans (`continues`)
export const OFFLINE_SONG_VERSION = 3
// Saved songs carry karaoke timing from this version on
const TIMED_SINCE_VERSION = 2

// The song can play synced: songs saved before timing was kept read as plain text until a sync fetches them again
export const isTimed = (song: OfflineSong) =>
  song.version >= TIMED_SINCE_VERSION

// A song saved on this device for reading without a connection
export interface OfflineSong {
  version: number
  videoId: string
  title: string
  author: string
  // A data: URL, so it shows without a connection
  thumbnail: string | null
  // When the song was first generated (its lyrics row's $createdAt), in ms: the list's order
  generatedAt: number
  // When its live lyrics were last written ($updatedAt): a sync fetches the song again when this moves
  updatedAt: number
  // The karaoke timing couldn't be fetched (the lookup service was down): the next sync tries again
  timingPending: boolean
  // The title as romaji, so it is found by what it sounds like
  titleRomaji: string
  lines: OfflineLine[]
}

const STANZA_GAP_SEC = 4

const KANJI = /[一-龯々]/u

// The song's own furigana are the readings of its title's kanji, which nearly always appear in the lyrics.
// Longest match first, so 夜空 is read as a word before 夜 alone
export const romanizeTitle = (title: string, lines: OfflineLine[]) => {
  const readings = new Map<string, string>()
  for (const line of lines) {
    for (const { base, rt } of line.ruby) {
      if (rt !== '' && KANJI.test(base) && !readings.has(base)) {
        readings.set(base, rt)
      }
    }
  }
  const bases = [...readings.keys()].toSorted((a, b) => b.length - a.length)
  const baseAt = (at: number) =>
    bases.find((candidate) => title.startsWith(candidate, at))
  let kana = ''
  let at = 0
  while (at < title.length) {
    const base = baseAt(at)
    if (base === undefined) {
      kana += title[at]
      at += 1
    } else {
      kana += readings.get(base) ?? base
      at += base.length
    }
  }
  return toRomaji(kana)
}

const textOf = (segments: RubySegment[]) =>
  segments.map((segment) => segment.base).join('')

// Stored lines sometimes start or end with a space, which would indent a block on the page
const trimSegments = (segments: RubySegment[]) =>
  segments.map((segment, index) => {
    let { base } = segment
    if (index === 0) {
      base = base.trimStart()
    }
    if (index === segments.length - 1) {
      base = base.trimEnd()
    }
    return { ...segment, base }
  })

const foldSpace = (text: string) =>
  text.trim().replaceAll(/\s+/gu, ' ').toLowerCase()

// Each shown line's translation in one language, and whether the next shown line shares it. `shown` are the
// lyrics' indices of the lines the reader shows (blank ones are left out), in order. A span's text goes after its
// last shown line. A run's translation that only repeats its lines (sung in English) is dropped, as the player
// drops it; a single line's is kept, as it always was here
const translationsOf = (
  perLine: readonly string[],
  docSpans: unknown,
  shown: readonly number[],
  sungText: (index: number) => string
) => {
  const spans = translationSpans(perLine, perLine.length, docSpans)
  return shown.map((index, at) => {
    const span = spans[index]
    const next = shown[at + 1]
    if (span === undefined) {
      return { continues: false, text: '' }
    }
    if (next !== undefined && next <= span.last) {
      return { continues: true, text: '' }
    }
    const sung = Array.from({ length: span.last - span.first + 1 }, (_, i) =>
      sungText(span.first + i)
    ).join(' ')
    const repeats =
      span.last > span.first && foldSpace(span.text) === foldSpace(sung)
    return { continues: false, text: repeats ? '' : span.text }
  })
}

// `doc` is the song's karaoke timing when its lines are these lyrics' (karaokeMatchesLyrics), else null: its lines
// time the karaoke fill and its spans group the translations
export const offlineLines = (
  lyrics: TimedLyrics,
  doc: Pick<KaraokeDoc, 'lines' | 'translations'> | null
): OfflineLine[] => {
  const rubies = lyrics.lines.map((line) =>
    trimSegments(parseRubyHtml(line.text))
  )
  const shown = lyrics.lines.flatMap((_, index) =>
    textOf(rubies[index]).trim() === '' &&
    (lyrics.romaji[index] ?? '').trim() === ''
      ? []
      : [index]
  )
  const sungText = (index: number) => textOf(rubies[index])
  // A span's lines are the doc's, so its spans count only with its lines
  const count = lyrics.lines.length
  const perLine = (column: readonly string[]) =>
    Array.from({ length: count }, (_, index) => column[index] ?? '')
  const en = translationsOf(
    perLine(lyrics.eng),
    doc?.translations.en?.spans,
    shown,
    sungText
  )
  const zh = translationsOf(
    perLine(lyrics.chi),
    doc?.translations.zh?.spans,
    shown,
    sungText
  )
  let lastEnd: number | null = null
  return shown.map((index, at) => {
    const line = lyrics.lines[index]
    const timed = doc?.lines[index] ?? null
    const stanza =
      lastEnd !== null && line.startSeconds - lastEnd >= STANZA_GAP_SEC
    lastEnd = line.endSeconds
    return {
      continues: { en: en[at].continues, zh: zh[at].continues },
      en: en[at].text,
      end: timed?.end ?? line.endSeconds,
      karaoke: timed,
      romaji: lyrics.romaji[index] ?? '',
      ruby: rubies[index],
      stanza,
      start: timed?.start ?? line.startSeconds,
      zh: zh[at].text,
    }
  })
}

// Where each line's translation span starts and ends among `lines`, by index, in the language shown. Without the
// translation shown, or with an empty one, nothing ties lines together and each is its own
export const lineSpans = (
  lines: readonly OfflineLine[],
  language: Language,
  translation: boolean
) => {
  const spans: { first: number; last: number }[] = []
  let first = 0
  for (const [index, line] of lines.entries()) {
    if (!(translation && line.continues?.[language] === true)) {
      const last = index
      const shared = translation && line[language].trim() !== ''
      for (let at = first; at <= last; at += 1) {
        spans.push(shared ? { first, last } : { first: at, last: at })
      }
      first = index + 1
    }
  }
  // A run cut off by the song's end (never in a valid doc) stands line by line
  for (let at = first; at < lines.length; at += 1) {
    spans.push({ first: at, last: at })
  }
  return spans
}

export const lineText = (line: OfflineLine) => textOf(line.ruby)
