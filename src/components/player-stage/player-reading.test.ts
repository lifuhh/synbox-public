import { describe, expect, test } from 'vite-plus/test'

import { holdReading } from './player-reading'

describe('holdReading', () => {
  // Paused at 1:03 of a 4:27 song, away to another app and back: the player was rebuilt, and until it
  // loaded the bar read 63 s against a duration of 0, which put the thumb at the end of the track
  test('keeps the last real reading while no player or a zero duration is reported', () => {
    const paused = { duration: 267, time: 63 }
    expect(holdReading(paused, null)).toBe(paused)
    expect(holdReading(paused, { duration: 0, time: 63 })).toEqual(paused)
    expect(
      holdReading(paused, { duration: Number.NaN, time: Number.NaN })
    ).toEqual(paused)
  })

  test('takes a real reading at once, including the start of the song', () => {
    expect(
      holdReading({ duration: 267, time: 63 }, { duration: 267, time: 0 })
    ).toEqual({
      duration: 267,
      time: 0,
    })
  })
})
