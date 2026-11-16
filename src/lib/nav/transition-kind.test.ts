import { describe, expect, test } from 'vite-plus/test'

import { depthOf, navKind } from './transition-kind'

const kind = (
  from: string,
  to: string,
  over: Partial<Parameters<typeof navKind>[0]> = {}
) =>
  navKind({
    from,
    osAnimated: false,
    reducedMotion: false,
    replace: false,
    to,
    touch: true,
    ...over,
  })

describe('depthOf', () => {
  test('tab pages are 0, their pages 1, pages under those 2', () => {
    expect(['/', '/search', '/library', '/you'].map(depthOf)).toEqual([
      0, 0, 0, 0,
    ])
    expect(
      ['/playlists', '/about', '/lyrics/abc', '/v/abc'].map(depthOf)
    ).toEqual([1, 1, 1, 1])
    expect(['/playlists/p1', '/v/abc/versions'].map(depthOf)).toEqual([2, 2])
  })
})

describe('navKind', () => {
  test('a touch screen slides deeper pages in and back out', () => {
    expect(kind('/library', '/playlists')).toBe('push')
    expect(kind('/playlists', '/playlists/p1')).toBe('push')
    expect(kind('/playlists/p1', '/playlists')).toBe('pop')
    expect(kind('/about', '/')).toBe('pop')
  })

  test('tab to tab, and pages at one depth, cross-fade', () => {
    expect(kind('/', '/search')).toBe('fade')
    expect(kind('/privacy', '/terms')).toBe('fade')
  })

  test('the player never slides: its video is not part of the page', () => {
    expect(kind('/', '/v/abc')).toBe('fade')
    expect(kind('/v/abc', '/v/abc/versions')).toBe('fade')
    expect(kind('/v/abc', '/library')).toBe('fade')
  })

  test('song to song keeps the player and animates nothing', () => {
    expect(kind('/v/abc', '/v/def')).toBe('none')
  })

  test('a mouse or Reduce Motion gets the fade instead of the slide', () => {
    expect(kind('/library', '/playlists', { touch: false })).toBe('fade')
    expect(kind('/library', '/playlists', { reducedMotion: true })).toBe('fade')
  })

  test('nothing moves for a redirect, a query change, or a swipe the system drew', () => {
    expect(kind('/library', '/playlists', { replace: true })).toBe('none')
    expect(kind('/search', '/search')).toBe('none')
    expect(kind('/playlists', '/library', { osAnimated: true })).toBe('none')
  })
})
