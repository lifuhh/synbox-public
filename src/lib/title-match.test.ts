import { expect, test } from 'vite-plus/test'

import { matchTitles } from './title-match'

const songs = [
  { author: 'YOASOBI', title: 'アイドル / Idol' },
  { author: 'Ado', title: '唱 (Show)' },
  { author: 'Kenshi Yonezu', title: 'Lemon' },
  { author: 'Ayase / YOASOBI', title: 'YOASOBI「優しい彗星」' },
]

test('every word must match the title or the channel, in any width or case', () => {
  expect(
    matchTitles(songs, 'ｙｏａｓｏｂｉ 彗星', 8).map((s) => s.title)
  ).toEqual(['YOASOBI「優しい彗星」'])
  expect(matchTitles(songs, 'kenshi lemon', 8)).toHaveLength(1)
})

test('a title starting with the query comes before one only holding it, and a blank query finds nothing', () => {
  expect(matchTitles(songs, 'yoasobi', 8).map((s) => s.title)).toEqual([
    'YOASOBI「優しい彗星」',
    'アイドル / Idol',
  ])
  expect(matchTitles(songs, '   ', 8)).toEqual([])
})
