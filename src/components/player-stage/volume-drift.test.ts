import { describe, expect, test } from 'vite-plus/test'

import { volumeDrift } from './use-you-tube-player'

const half = { level: 0.5, muted: false }

describe('volumeDrift', () => {
  test('sound under a muted control is muted again, playing or not', () => {
    const want = { level: 0.5, muted: true }
    expect(volumeDrift(want, { muted: false, volume: 50 }, true)).toBe('mute')
    expect(volumeDrift(want, { muted: false, volume: 50 }, false)).toBe('mute')
  })

  test('silence under an unmuted control shows as blocked only while the song plays', () => {
    expect(volumeDrift(half, { muted: true, volume: 50 }, true)).toBe('blocked')
    expect(volumeDrift(half, { muted: true, volume: 50 }, false)).toBe('none')
  })

  test('a level YouTube reports more than 1 off is applied again; a muted control ignores the level', () => {
    expect(volumeDrift(half, { muted: false, volume: 80 }, true)).toBe('level')
    expect(volumeDrift(half, { muted: false, volume: 51 }, true)).toBe('none')
    expect(
      volumeDrift(
        { level: 0.5, muted: true },
        { muted: true, volume: 80 },
        true
      )
    ).toBe('none')
  })
})
