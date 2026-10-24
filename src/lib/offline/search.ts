import { toRomaji } from 'wanakana'

import { withoutTrace } from '@/lib/lyrics-api'

import type { OfflineSong } from './song'
import { lineText } from './song'

const LATIN_ACCENTED = /[À-ɏ]/gu
const KATAKANA = /[ァ-ヶ]/gu
const NOT_A_WORD_CHARACTER = /[^\p{L}\p{N}]/gu
const DOUBLED_VOWEL = /(?<vowel>[aeiou])\k<vowel>+/gu

// One spelling for the many ways a word is typed: width, case, macrons (ō), long vowels (ou, oo, uu), katakana
// as hiragana, and no spaces or punctuation. "Toukyou", "tōkyō" and "tokyo" all become "tokyo"
export const fold = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(LATIN_ACCENTED, (char) => char.normalize('NFD')[0] ?? char)
    .replaceAll(KATAKANA, (char) =>
      String.fromCodePoint((char.codePointAt(0) ?? 0) - 0x60)
    )
    .replaceAll(NOT_A_WORD_CHARACTER, '')
    .replaceAll('ou', 'o')
    .replaceAll(DOUBLED_VOWEL, '$<vowel>')

// Where a song matched: its title, its artist, or a line of its lyrics (shown under the row)
export type SearchMatch =
  | { kind: 'title' }
  | { kind: 'artist' }
  | { kind: 'lyrics'; line: string }

const RANK = { artist: 1, lyrics: 2, title: 0 } as const

export interface SearchIndexEntry<Song = OfflineSong> {
  song: Song
  title: string[]
  artist: string[]
  lines: { shown: string; keys: string[] }[]
}

export const indexSong = (song: OfflineSong): SearchIndexEntry => ({
  artist: [fold(song.author), fold(toRomaji(song.author))],
  lines: song.lines.map((line) => ({
    keys: [
      fold(lineText(line)),
      fold(line.romaji),
      fold(withoutTrace(line.en)),
      fold(withoutTrace(line.zh)),
    ],
    shown: line.romaji === '' ? lineText(line) : line.romaji,
  })),
  song,
  title: [fold(song.title), fold(song.titleRomaji)],
})

const matchTerm = <Song>(
  entry: SearchIndexEntry<Song>,
  term: string
): SearchMatch | null => {
  if (entry.title.some((key) => key.includes(term))) {
    return { kind: 'title' }
  }
  if (entry.artist.some((key) => key.includes(term))) {
    return { kind: 'artist' }
  }
  const line = entry.lines.find(({ keys }) =>
    keys.some((key) => key.includes(term))
  )
  return line === undefined ? null : { kind: 'lyrics', line: line.shown }
}

// Every word of the query must match somewhere. Title matches come first, then artist, then lyrics; within
// each, the entries keep the order they were given in
export interface SearchResult<Song = OfflineSong> {
  song: Song
  match: SearchMatch | null
}

export const searchSongs = <Song>(
  entries: SearchIndexEntry<Song>[],
  query: string
): SearchResult<Song>[] => {
  const terms = query.split(/\s+/u).map(fold).filter(Boolean)
  if (terms.length === 0) {
    return entries.map((entry) => ({ match: null, song: entry.song }))
  }
  const found: { song: Song; match: SearchMatch; rank: number }[] = []
  for (const entry of entries) {
    let weakest: SearchMatch | null = null
    for (const term of terms) {
      const match = matchTerm(entry, term)
      if (match === null) {
        weakest = null
        break
      }
      if (weakest === null || RANK[match.kind] > RANK[weakest.kind]) {
        weakest = match
      }
    }
    if (weakest !== null) {
      found.push({ match: weakest, rank: RANK[weakest.kind], song: entry.song })
    }
  }
  return found
    .toSorted((a, b) => a.rank - b.rank)
    .map(({ match, song }) => ({ match, song }))
}
