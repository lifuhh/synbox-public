import { describe, expect, it } from 'vite-plus/test'

import type { ListSong } from './model'
import type { SongFacets } from './next-filter'
import { applyFilter, filterLabel, nextFilters } from './next-filter'

const song = (videoId: string, author: string): ListSong => ({
  author,
  thumbnailUrl: '',
  title: videoId,
  videoId,
})

const songs = [song('a', 'Yorushika'), song('b', 'Ado'), song('c', 'Aimer')]
const facets = new Map<string, SongFacets>([
  ['a', { artist: 'Yorushika', mood: 'calm', vocal: 'female' }],
  ['b', { artist: 'Ado', mood: 'sad', vocal: 'female' }],
  // A song with no tags yet
  ['c', { artist: 'Aimer', mood: null, vocal: 'unknown' }],
])

describe('nextFilters', () => {
  it('offers the playing song’s artist, mood and singer only where the list has a match', () => {
    const playing = { artist: 'Yorushika', mood: 'sad', vocal: 'female' }
    expect(nextFilters(playing, songs, facets).map(filterLabel)).toEqual([
      'All',
      'From Yorushika',
      'Sad',
      'Female Vocals',
    ])
    const lonely = { artist: 'Nobody', mood: 'angry', vocal: 'male' }
    expect(nextFilters(lonely, songs, facets).map(filterLabel)).toEqual(['All'])
  })

  it('never offers an unknown singer as a chip', () => {
    const playing = { artist: 'Aimer', mood: null, vocal: 'unknown' }
    expect(nextFilters(playing, songs, facets).map(filterLabel)).toEqual([
      'All',
      'From Aimer',
    ])
  })
})

describe('applyFilter', () => {
  it('keeps the list’s order and leaves out untagged songs from a mood', () => {
    expect(
      applyFilter({ kind: 'vocal', vocal: 'female' }, songs, facets).map(
        (s) => s.videoId
      )
    ).toEqual(['a', 'b'])
    expect(
      applyFilter({ kind: 'mood', mood: 'sad' }, songs, facets).map(
        (s) => s.videoId
      )
    ).toEqual(['b'])
  })
})
