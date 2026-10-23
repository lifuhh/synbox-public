import { expect, test } from 'vite-plus/test'

import { extractVideoId, ownSongPath } from '@/utils'

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
