import { describe, expect, test } from 'vite-plus/test'

import raw from './entries.json'
import { parseEntries, whatsNewUnread } from './model'

describe('whatsNewUnread', () => {
  test('a listener who knew Synbox before hears about the newest release once', () => {
    // A returning browser that never opened What's New
    expect(whatsNewUnread('b', null, true)).toBe(true)
    // An account that saw an older entry, on a browser new to Synbox
    expect(whatsNewUnread('b', 'a', false)).toBe(true)
    // Already seen
    expect(whatsNewUnread('b', 'b', true)).toBe(false)
  })

  test('someone new to Synbox is not told what changed', () => {
    expect(whatsNewUnread('b', null, false)).toBe(false)
  })
})

const entry = (id: string, date: string | null) => ({
  date,
  id,
  items: ['Bug fixes and performance improvements'],
  title: 'Fixes',
})

describe('parseEntries', () => {
  test('the shipped entries are well formed, newest first', () => {
    expect(parseEntries(raw).length).toBeGreaterThan(0)
  })

  test('only the newest entry may wait for its ship date', () => {
    expect(() =>
      parseEntries([entry('b', '2026-11-12'), entry('a', null)])
    ).toThrow(/undated/u)
    expect(() =>
      parseEntries([entry('a', '2026-10-30'), entry('b', '2026-11-12')])
    ).toThrow(/newest first/u)
  })
})
