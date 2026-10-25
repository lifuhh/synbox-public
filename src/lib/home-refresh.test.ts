import { describe, expect, test } from 'vite-plus/test'

import { REFETCH_AFTER_MS, shouldRefetch } from './home-refresh'

describe('shouldRefetch', () => {
  test('taps closer together than the refetch window only reshuffle, so they cost no quota', () => {
    expect(shouldRefetch(10_000 + REFETCH_AFTER_MS - 1, 10_000)).toBe(false)
    expect(shouldRefetch(10_000 + REFETCH_AFTER_MS, 10_000)).toBe(true)
  })

  test('a list that never loaded is fetched', () => {
    expect(shouldRefetch(1000, 0)).toBe(true)
  })
})
