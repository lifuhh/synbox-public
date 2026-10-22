import { expect, test } from 'vite-plus/test'

import { extractVideoId } from '@/utils'

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
