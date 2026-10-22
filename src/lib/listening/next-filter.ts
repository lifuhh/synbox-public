import type { ListSong } from './model'

// What the list beside the video knows about a song beyond its title: its artist, its strongest mood and the
// kind of singer. Library songs have them from the backend's tags; a song with no tags has no mood and an
// unknown singer
export interface SongFacets {
  artist: string
  mood: string | null
  vocal: string
}

// The chips over the list, as YouTube's over its own: all of it, or the songs that share one thing with the
// song playing
export type NextFilter =
  | { kind: 'all' }
  | { kind: 'artist'; artist: string }
  | { kind: 'mood'; mood: string }
  | { kind: 'vocal'; vocal: string }

export const ALL: NextFilter = { kind: 'all' }

const VOCALS: Record<string, string> = {
  female: 'Female Vocals',
  male: 'Male Vocals',
  mixed: 'Mixed Vocals',
  synth: 'Vocal Synth',
}

export const filterLabel = (filter: NextFilter): string => {
  switch (filter.kind) {
    case 'all': {
      return 'All'
    }
    case 'artist': {
      return `From ${filter.artist}`
    }
    case 'mood': {
      return filter.mood.charAt(0).toUpperCase() + filter.mood.slice(1)
    }
    case 'vocal': {
      return VOCALS[filter.vocal] ?? filter.vocal
    }
    default: {
      return filter satisfies never
    }
  }
}

export const filterKey = (filter: NextFilter): string => {
  switch (filter.kind) {
    case 'all': {
      return 'all'
    }
    case 'artist': {
      return `artist:${filter.artist}`
    }
    case 'mood': {
      return `mood:${filter.mood}`
    }
    case 'vocal': {
      return `vocal:${filter.vocal}`
    }
    default: {
      return filter satisfies never
    }
  }
}

const matches = (
  filter: NextFilter,
  song: ListSong,
  facets: SongFacets | undefined
): boolean => {
  switch (filter.kind) {
    case 'all': {
      return true
    }
    case 'artist': {
      return song.author === filter.artist
    }
    case 'mood': {
      return facets?.mood === filter.mood
    }
    case 'vocal': {
      return facets?.vocal === filter.vocal
    }
    default: {
      return filter satisfies never
    }
  }
}

export const applyFilter = (
  filter: NextFilter,
  songs: ListSong[],
  facets: ReadonlyMap<string, SongFacets>
): ListSong[] =>
  songs.filter((song) => matches(filter, song, facets.get(song.videoId)))

// The chips for the song playing: All, then its artist, its mood and its kind of singer, in the order the list
// ranks by, each only when at least one listed song shares it
export const nextFilters = (
  current: SongFacets | null,
  songs: ListSong[],
  facets: ReadonlyMap<string, SongFacets>
): NextFilter[] => {
  if (current === null) {
    return [ALL]
  }
  const candidates: NextFilter[] = [
    { artist: current.artist, kind: 'artist' },
    ...(current.mood === null
      ? []
      : [{ kind: 'mood' as const, mood: current.mood }]),
    ...(current.vocal in VOCALS
      ? [{ kind: 'vocal' as const, vocal: current.vocal }]
      : []),
  ]
  return [
    ALL,
    ...candidates.filter(
      (filter) => applyFilter(filter, songs, facets).length > 0
    ),
  ]
}
