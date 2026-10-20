import { describe, expect, test } from 'vite-plus/test'

import { clampSeek, holdStep } from './seek-steps'

describe('holdStep', () => {
  test('ramps 5 s x4, 10 s x4, then 30 s for as long as the key is held', () => {
    const steps = Array.from({ length: 12 }, (_, jump) => holdStep(jump))
    expect(steps).toEqual([5, 5, 5, 5, 10, 10, 10, 10, 30, 30, 30, 30])
  })
})

describe('clampSeek', () => {
  test('a jump past the end stops at the end guard, never on the end itself', () => {
    expect(clampSeek(240 + 30, 240, 1)).toBe(239)
    expect(clampSeek(240, 240, 1)).toBe(239)
  })

  test('a jump back past the start stops at 0', () => {
    expect(clampSeek(3 - 30, 240, 1)).toBe(0)
  })

  test('before the duration is known only the start is enforced', () => {
    expect(clampSeek(500, 0, 1)).toBe(500)
  })
})
