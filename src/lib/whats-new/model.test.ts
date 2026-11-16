import { describe, expect, test } from 'vite-plus/test'

import raw from './entries.json'
import { parseEntries, recentCount, whatsNewUnread } from './model'

describe('recentCount', () => {
  const ids = ['d', 'c', 'b', 'a']
  test('the entries a listener missed go above the divider, at least the newest', () => {
    // Back after missing three releases
    expect(recentCount(ids, 'a')).toBe(3)
    // Read the newest already, or never opened the page
    expect(recentCount(ids, 'd')).toBe(1)
    expect(recentCount(ids, null)).toBe(1)
    // Their last read entry was since removed
    expect(recentCount(ids, 'gone')).toBe(1)
  })
})

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

const long = (date: string | null) => ({
  ...entry('long', date),
  items: ['a', 'b', 'c', 'd', 'e', 'f'],
})

describe('parseEntries', () => {
  test('the shipped entries are well formed, newest first', () => {
    expect(parseEntries(raw).length).toBeGreaterThan(0)
  })

  test('an entry is a summary: a sixth line is refused, older entries keep theirs', () => {
    expect(() => parseEntries([long(null)])).toThrow(/5 at most/u)
    expect(() => parseEntries([long('2026-11-16')])).toThrow(/5 at most/u)
    expect(parseEntries([long('2026-10-30')])).toHaveLength(1)
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
