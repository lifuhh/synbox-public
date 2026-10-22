import { describe, expect, test } from 'vite-plus/test'

import { isSyncedKey, reconcile } from './model'

describe('reconcile', () => {
  test('each setting takes the newer side, so two devices changing different settings both keep theirs', () => {
    const { apply, send } = reconcile(
      {
        fontSizeMultiplier: { at: 30, value: 1.2 },
        lyricsTheme: { at: 10, value: 'sakura' },
      },
      {
        fontSizeMultiplier: { at: 5, value: 1 },
        lyricsTheme: { at: 20, value: 'aqua' },
      },
      100
    )
    expect(apply).toEqual([{ at: 30, key: 'fontSizeMultiplier', value: 1.2 }])
    expect(send).toEqual([{ at: 20, key: 'lyricsTheme', value: 'aqua' }])
  })

  test("a style set before syncing existed goes up only when the account has none, and loses to the account's", () => {
    const { apply, send } = reconcile(
      { lyricsTheme: { at: 10, value: 'matcha' } },
      {
        lyricsTheme: { at: undefined, value: 'aqua' },
        lyricsTwoLines: { at: undefined, value: true },
      },
      100
    )
    expect(apply).toEqual([{ at: 10, key: 'lyricsTheme', value: 'matcha' }])
    expect(send).toEqual([{ at: 100, key: 'lyricsTwoLines', value: true }])
  })

  test('a song style reset on this device is sent as cleared, and one cleared on the account is cleared here', () => {
    const { apply, send } = reconcile(
      {
        'lyricsStyle:aaaaaaaaaaa': { at: 5, value: { v: 1 } },
        'lyricsStyle:bbbbbbbbbbb': { at: 50, value: null },
      },
      {
        'lyricsStyle:aaaaaaaaaaa': { at: 9, value: undefined },
        'lyricsStyle:bbbbbbbbbbb': { at: 40, value: { v: 1 } },
      },
      100
    )
    expect(send).toEqual([
      { at: 9, key: 'lyricsStyle:aaaaaaaaaaa', value: null },
    ])
    expect(apply).toEqual([
      { at: 50, key: 'lyricsStyle:bbbbbbbbbbb', value: null },
    ])
  })

  test('the same change on both sides does nothing', () => {
    expect(
      reconcile(
        { lyricsTheme: { at: 10, value: 'aqua' } },
        { lyricsTheme: { at: 10, value: 'aqua' } },
        100
      )
    ).toEqual({ apply: [], send: [] })
  })
})

test('settings that belong to one device never sync', () => {
  expect(isSyncedKey('lyricsStyle:x1FV6IrjZCY')).toBe(true)
  expect(isSyncedKey('lyricsTheme')).toBe(true)
  expect(isSyncedKey('playerVolume')).toBe(false)
  expect(isSyncedKey('playerWatchLayout')).toBe(false)
  expect(isSyncedKey('lyricsStyle:../x')).toBe(false)
})
