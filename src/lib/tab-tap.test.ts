import { describe, expect, test } from 'vite-plus/test'

import { tabTap } from './tab-tap'

const tap = (over: Partial<Parameters<typeof tabTap>[0]>) =>
  tabTap({
    atTop: false,
    current: true,
    home: true,
    sinceLastTapMs: Number.POSITIVE_INFINITY,
    ...over,
  })

describe('tabTap', () => {
  test('another page’s tab navigates, scrolled or not', () => {
    expect(tap({ current: false })).toBe('navigate')
    expect(tap({ atTop: true, current: false, sinceLastTapMs: 100 })).toBe(
      'navigate'
    )
  })

  test('the current tab scrolled down goes to the top', () => {
    expect(tap({})).toBe('scroll')
    expect(tap({ home: false })).toBe('scroll')
  })

  test('Home at the top, or tapped twice within 400ms, asks for the update', () => {
    expect(tap({ atTop: true })).toBe('update')
    expect(tap({ sinceLastTapMs: 250 })).toBe('update')
    expect(tap({ sinceLastTapMs: 400 })).toBe('scroll')
  })

  test('other tabs never update: at the top their link keeps its old behaviour', () => {
    expect(tap({ atTop: true, home: false })).toBe('navigate')
    expect(tap({ home: false, sinceLastTapMs: 100 })).toBe('scroll')
  })
})
