import { expect, test } from 'vite-plus/test'

import { extractVideoId, ownSongPath, readFieldText } from '@/utils'

test('our own song links open in the app, query kept; other hosts and pages do not', () => {
  expect(ownSongPath('synbox.io/v/lOxVMzDgALs')).toBe('/v/lOxVMzDgALs')
  expect(ownSongPath(' https://www.synbox.io/v/lOxVMzDgALs?style=abc ')).toBe(
    '/v/lOxVMzDgALs?style=abc'
  )
  expect(ownSongPath('synbox.io/lyrics/lOxVMzDgALs')).toBe(
    '/lyrics/lOxVMzDgALs'
  )
  expect(ownSongPath('example.com/v/lOxVMzDgALs')).toBeNull()
  expect(ownSongPath('synbox.io/playlists/lOxVMzDgALs')).toBeNull()
  expect(ownSongPath('https://youtu.be/lOxVMzDgALs')).toBeNull()
  expect(ownSongPath('lOxVMzDgALs')).toBeNull()
})

test("our own links give the song's id, as YouTube's do", () => {
  expect(extractVideoId('https://synbox.io/v/OP2OgoHDbBg')).toBe('OP2OgoHDbBg')
  expect(extractVideoId('synbox.io/v/OP2OgoHDbBg/versions')).toBe('OP2OgoHDbBg')
  expect(extractVideoId('https://synbox.io/lyrics/OP2OgoHDbBg?t=1')).toBe(
    'OP2OgoHDbBg'
  )
  expect(extractVideoId('https://youtu.be/OP2OgoHDbBg')).toBe('OP2OgoHDbBg')
  expect(extractVideoId('https://synbox.io/v/short')).toBeNull()
  expect(extractVideoId('https://synbox.io/playlists/OP2OgoHDbBg')).toBeNull()
})

const video = (videoId: string) => ({ kind: 'video', videoId })

test('a pasted link reads the same in every search field: the shapes YouTube shares, with their extras', () => {
  expect(readFieldText('https://youtu.be/OP2OgoHDbBg?si=AbC123')).toEqual(
    video('OP2OgoHDbBg')
  )
  expect(
    readFieldText('https://www.youtube.com/watch?v=OP2OgoHDbBg&t=42s')
  ).toEqual(video('OP2OgoHDbBg'))
  expect(
    readFieldText('https://youtube.com/shorts/OP2OgoHDbBg?feature=share')
  ).toEqual(video('OP2OgoHDbBg'))
  expect(readFieldText('https://m.youtube.com/watch?v=OP2OgoHDbBg')).toEqual(
    video('OP2OgoHDbBg')
  )
  expect(
    readFieldText(
      'https://music.youtube.com/watch?v=OP2OgoHDbBg&list=RDAMVMOP2OgoHDbBg'
    )
  ).toEqual(video('OP2OgoHDbBg'))
  expect(readFieldText('synbox.io/v/OP2OgoHDbBg?style=abc')).toEqual({
    kind: 'own',
    path: '/v/OP2OgoHDbBg?style=abc',
  })
  // A channel or a playlist names no one video; words are a search, an 11-letter word included
  expect(readFieldText('https://www.youtube.com/@YOASOBI_CH')).toEqual({
    kind: 'bad',
  })
  expect(
    readFieldText('https://www.youtube.com/playlist?list=PL12345678')
  ).toEqual({ kind: 'bad' })
  expect(readFieldText(' yoasobi idol ')).toEqual({
    kind: 'search',
    query: 'yoasobi idol',
  })
  expect(readFieldText('watercolour')).toEqual({
    kind: 'search',
    query: 'watercolour',
  })
})
