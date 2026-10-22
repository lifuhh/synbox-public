import { expect, test } from 'bun:test'

import { addListen, likerOf, readStats, setLike } from './songs'
import { migratedD1 } from './test-d1'

const SONG = '6rG_irmOQsM'
const DEVICE = '0f8b3c3e-6a1e-4c62-9d2a-5b7d1f0c9e11'

test('every visit counts a listen; a song nobody played has none', async () => {
  const { db } = migratedD1()
  const before = await readStats(db, SONG, null)
  await addListen(db, SONG)
  await addListen(db, SONG)
  const after = await readStats(db, SONG, null)
  expect([before.listens, after.listens]).toEqual([0, 2])
})

test('one like per account or device: liking twice counts once, unliking takes it back', async () => {
  const { db } = migratedD1()
  const guest = likerOf(null, DEVICE)
  const account = likerOf('user-1', DEVICE)
  expect(guest).toBe(`d:${DEVICE}`)
  // Signed in, the account likes, not the device
  expect(account).toBe('u:user-1')
  await setLike(db, SONG, guest ?? '', true, 1)
  await setLike(db, SONG, guest ?? '', true, 2)
  await setLike(db, SONG, account ?? '', true, 3)
  expect(await readStats(db, SONG, guest)).toEqual({
    liked: true,
    likes: 2,
    listens: 0,
  })
  await setLike(db, SONG, guest ?? '', false, 4)
  expect(await readStats(db, SONG, guest)).toEqual({
    liked: false,
    likes: 1,
    listens: 0,
  })
})

test('a guest without a well-formed device id cannot like', () => {
  expect(likerOf(null, null)).toBeNull()
  expect(likerOf(null, 'not-a-uuid')).toBeNull()
})
