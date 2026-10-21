import { toRomaji } from 'wanakana'

import type { RubySegment } from '@/lib/furigana'
import { parseRubyHtml } from '@/lib/furigana'
import type { TimedLyrics } from '@/lib/lyrics-document'

// One sung line as the reader shows it: the Japanese with its furigana, then romaji and both translations
export interface OfflineLine {
  ruby: RubySegment[]
  romaji: string
  en: string
  zh: string
  // A pause of STANZA_GAP_SEC or more before it, so the reader starts a new paragraph
  stanza: boolean
}

// A song saved on this device for reading without a connection
export interface OfflineSong {
  videoId: string
  title: string
  author: string
  // A data: URL, so it shows without a connection
  thumbnail: string | null
  // When the song was first generated (its lyrics row's $createdAt), in ms: the list's order
  generatedAt: number
  // When its live lyrics were last written ($updatedAt): a sync fetches the song again when this moves
  updatedAt: number
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

export const offlineLines = (lyrics: TimedLyrics): OfflineLine[] => {
  const lines: OfflineLine[] = []
  let lastEnd: number | null = null
  for (const [index, line] of lyrics.lines.entries()) {
    const ruby = trimSegments(parseRubyHtml(line.text))
    const romaji = lyrics.romaji[index] ?? ''
    if (textOf(ruby).trim() === '' && romaji.trim() === '') {
      continue
    }
    lines.push({
      en: lyrics.eng[index] ?? '',
      romaji,
      ruby,
      stanza: lastEnd !== null && line.startSeconds - lastEnd >= STANZA_GAP_SEC,
      zh: lyrics.chi[index] ?? '',
    })
    lastEnd = line.endSeconds
  }
  return lines
}

export const lineText = (line: OfflineLine) => textOf(line.ruby)
