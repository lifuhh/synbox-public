import { describe, expect, it } from 'vite-plus/test'

import { fold, indexSong, searchSongs } from './search'
import type { OfflineLine, OfflineSong } from './song'
import { romanizeTitle } from './song'

const line = (
  ruby: OfflineLine['ruby'],
  romaji: string,
  en = ''
): OfflineLine => ({ en, romaji, ruby, stanza: false, zh: '' })

const song = (
  videoId: string,
  title: string,
  author: string,
  lines: OfflineLine[]
): OfflineSong => ({
  author,
  generatedAt: 0,
  lines,
  thumbnail: null,
  title,
  titleRomaji: romanizeTitle(title, lines),
  updatedAt: 0,
  videoId,
})

const ids = (results: { song: OfflineSong }[]) =>
  results.map((result) => result.song.videoId)

describe('fold', () => {
  it('spells long vowels, macrons and katakana one way', () => {
    expect(fold('Tōkyō')).toBe('tokyo')
    expect(fold('toukyou')).toBe('tokyo')
    expect(fold('トーキョー')).toBe(fold('とーきょー'))
    expect(fold('ＹＯＡＳＯＢＩ ・ Idol!')).toBe('yoasobidol')
  })
})

describe('romanizeTitle', () => {
  it('reads the kanji with the furigana from the song’s own lyrics', () => {
    const lines = [
      line(
        [
          { base: '夜空', rt: 'よぞら' },
          { base: 'に', rt: '' },
          { base: '光', rt: 'ひかり' },
        ],
        'yozora ni hikari'
      ),
    ]
    expect(romanizeTitle('夜空の光「ライト」', lines)).toContain(
      'yozoranohikari'
    )
    expect(romanizeTitle('夜空の光「ライト」', lines)).toContain('raito')
  })
})

describe('searchSongs', () => {
  const idol = song('idol', 'アイドル', 'YOASOBI', [
    line(
      [{ base: '星', rt: 'ほし' }],
      'hoshi no kakera',
      'a shard of a star'
    ),
  ])
  const night = song('night', '夜に駆ける', 'YOASOBI', [
    line(
      [
        { base: '夜', rt: 'よる' },
        { base: 'に', rt: '' },
        { base: '駆', rt: 'か' },
        { base: 'ける', rt: '' },
      ],
      'yoru ni kakeru'
    ),
  ])
  const other = song('other', 'Lemon', '米津玄師', [
    line([{ base: 'アイドル', rt: '' }], 'aidoru'),
  ])
  const index = [night, idol, other].map(indexSong)

  it('finds a katakana title by its romaji, title matches before lyrics matches', () => {
    expect(ids(searchSongs(index, 'aidoru'))).toEqual(['idol', 'other'])
  })

  it('finds a kanji title by the romaji of its reading', () => {
    expect(ids(searchSongs(index, 'yoru ni kakeru'))).toEqual(['night'])
  })

  it('needs every word to match, across title, artist and lyrics', () => {
    expect(ids(searchSongs(index, 'yoasobi shard'))).toEqual(['idol'])
  })

  it('shows the lyric line a lyrics-only match came from', () => {
    const [result] = searchSongs(index, 'kakera')
    expect(result?.match).toEqual({ kind: 'lyrics', line: 'hoshi no kakera' })
  })

  it('keeps the given order for an empty query', () => {
    expect(ids(searchSongs(index, '  '))).toEqual(['night', 'idol', 'other'])
  })
})
