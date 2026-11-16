import { describe, expect, test } from 'vite-plus/test'

import { keepable, MAX_AGE_MS, persistRule, restorable } from './persist'
import { inShownOrder } from './queries-and-mutations'
import { QUERY_KEYS } from './query-keys'

const NOW = 1_800_000_000_000

const saved = (queryKey: unknown[], age = 1000, data: unknown = ['x']) => ({
  data,
  dataUpdatedAt: NOW - age,
  queryKey,
})

describe('what is kept on the device', () => {
  test('nothing about an account, a session, the admin page, a generation or lyrics', () => {
    const kept = Object.values(QUERY_KEYS).filter(
      (key) => persistRule([key]) !== undefined
    )
    expect(kept.toSorted()).toEqual(
      [
        QUERY_KEYS.GET_CHARTS_PLAYLIST,
        QUERY_KEYS.GET_GALLERY_SONGS,
        QUERY_KEYS.GET_LANDING_PAGE_PLAYLIST,
        QUERY_KEYS.GET_LISTEN_COUNTS,
        QUERY_KEYS.GET_RECENT_LISTENS,
        QUERY_KEYS.GET_SIMILAR_SONGS,
        QUERY_KEYS.GET_SONG_INFO_BY_SONG_ID,
        QUERY_KEYS.GET_YOUTUBE_VIDEO_INFO,
      ].toSorted()
    )
    // A song's stats hold this account's like; a key that isn't a known name is never kept
    expect(persistRule([QUERY_KEYS.GET_SONG_STATS, 'abcdefghijk'])).toBe(
      undefined
    )
    expect(persistRule(['constructor'])).toBe(undefined)
    expect(persistRule([])).toBe(undefined)
  })

  test('a stored copy holding a key that is no longer allowed gives that key back to nobody', () => {
    const entries = restorable(
      {
        buster: 'b1',
        queries: [
          saved([QUERY_KEYS.GET_ME], 1000, { email: 'someone' }),
          saved([QUERY_KEYS.GET_GALLERY_SONGS]),
        ],
      },
      'b1',
      NOW
    )
    expect(entries.map((entry) => entry.queryKey[0])).toEqual([
      QUERY_KEYS.GET_GALLERY_SONGS,
    ])
  })

  test('another build’s copy, a copy in another shape and broken entries are all dropped', () => {
    const queries = [saved([QUERY_KEYS.GET_GALLERY_SONGS])]
    expect(restorable({ buster: 'b0', queries }, 'b1', NOW)).toEqual([])
    expect(restorable('{"buster":"b1"}', 'b1', NOW)).toEqual([])
    expect(restorable({ buster: 'b1', queries: 'none' }, 'b1', NOW)).toEqual([])
    expect(restorable(null, 'b1', NOW)).toEqual([])
    expect(
      restorable(
        {
          buster: 'b1',
          queries: [
            null,
            { queryKey: QUERY_KEYS.GET_GALLERY_SONGS },
            { data: [], dataUpdatedAt: 'now', queryKey: ['getGallerySongs'] },
            // A shuffled list that is not a list would break the launch shuffle
            saved([QUERY_KEYS.GET_GALLERY_SONGS], 1000, { songs: [] }),
          ],
        },
        'b1',
        NOW
      )
    ).toEqual([])
  })

  test('a copy past its age or dated after now is dropped', () => {
    const key = [QUERY_KEYS.GET_CHARTS_PLAYLIST]
    expect(keepable([saved(key, MAX_AGE_MS)], NOW)).toHaveLength(1)
    expect(keepable([saved(key, MAX_AGE_MS + 1)], NOW)).toHaveLength(0)
    expect(keepable([saved(key, -1)], NOW)).toHaveLength(0)
  })

  test('a per-song key keeps only its newest songs', () => {
    const songs = Array.from({ length: 40 }, (_, age) =>
      saved([QUERY_KEYS.GET_SIMILAR_SONGS, `song-${age}`], age)
    )
    const kept = keepable(songs.toReversed(), NOW)
    expect(kept).toHaveLength(30)
    expect(kept[0].queryKey[1]).toBe('song-0')
    expect(kept.at(-1)?.queryKey[1]).toBe('song-29')
  })
})

const song = (videoId: string, title = videoId) => ({ title, videoId })

describe('a list fetched again while it shows', () => {
  test('keeps the shown order, takes new details, drops songs that left and adds new ones last', () => {
    expect(
      inShownOrder(
        [song('a'), song('b'), song('c')],
        [song('d'), song('c', 'renamed'), song('a')]
      )
    ).toEqual([song('a'), song('c', 'renamed'), song('d')])
  })

  test('the first fetch is shown as it came', () => {
    expect(inShownOrder(undefined, [song('b'), song('a')])).toEqual([
      song('b'),
      song('a'),
    ])
  })
})
