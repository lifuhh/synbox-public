import { expect, test } from 'vite-plus/test'

import { VIDEO_REFUSALS, videoRefusal } from './preflight'

const song = (seconds: number | null) => ({ seconds, title: 'Song' })
const code = (refusal: ReturnType<typeof videoRefusal>) => refusal?.code ?? null

test('a video takes 1 to 8 minutes, inclusive, as the backend does', () => {
  expect(code(videoRefusal(song(59), true))).toBe('too_short')
  expect(code(videoRefusal(song(60), true))).toBeNull()
  expect(code(videoRefusal(song(480), true))).toBeNull()
  expect(code(videoRefusal(song(481), true))).toBe('too_long')
  expect(videoRefusal(song(481), true)?.message).toBe(VIDEO_REFUSALS.too_long)
})

test('no such video is refused, whatever the player said', () => {
  expect(code(videoRefusal(null, true))).toBe('not_found')
})

test('a length YouTube gave as nothing (a live stream, or none) leaves it to the backend', () => {
  expect(code(videoRefusal(song(null), true))).toBeNull()
  expect(code(videoRefusal(song(0), true))).toBeNull()
})

test('the player refusing the embed refuses it, even when YouTube could not be asked', () => {
  expect(code(videoRefusal(song(200), false))).toBe('youtube_only')
  expect(code(videoRefusal('unknown', false))).toBe('youtube_only')
  expect(code(videoRefusal('unknown', true))).toBeNull()
})
