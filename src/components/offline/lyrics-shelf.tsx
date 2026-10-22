import { useAtomValue } from 'jotai'
import { CloudOffIcon, SearchIcon, XIcon } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'

import { OfflineSongRow } from '@/components/offline/offline-song-row'
import { favoritesAtom, historyAtom } from '@/lib/library/store'
import { indexSong, searchSongs } from '@/lib/offline/search'
import type { OfflineSource, SyncStatus } from '@/lib/offline/sync'
import {
  RECENT_LIMIT,
  readMySongs,
  requestSync,
  useOfflineSongs,
  useSyncStatus,
} from '@/lib/offline/sync'
import { useOnline } from '@/lib/pwa'
import { cn } from '@/utils/cn'

// The saved songs to read, searched and filtered: one state behind both the Lyrics page and the top bar's
// Lyrics menu, each laying the pieces below out its own way

type Filter = 'all' | OfflineSource

const FILTERS: { id: Filter; label: string; empty: string }[] = [
  { empty: 'No songs saved yet.', id: 'all', label: 'All' },
  {
    empty: 'Songs you generate while signed in are saved here.',
    id: 'mine',
    label: 'My Songs',
  },
  {
    empty: 'Bookmark a song and its lyrics are saved here.',
    id: 'bookmark',
    label: 'Bookmarks',
  },
  {
    empty: `The last ${RECENT_LIMIT} songs you opened are saved here.`,
    id: 'recent',
    label: 'Recent',
  },
]

const MINUTE = 60_000

const ago = (ms: number) => {
  const minutes = Math.round((Date.now() - ms) / MINUTE)
  if (minutes < 1) {
    return 'just now'
  }
  if (minutes < 60) {
    return `${minutes} min ago`
  }
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

const statusText = (status: SyncStatus, online: boolean, saved: number) => {
  const count = `${saved} ${saved === 1 ? 'song' : 'songs'} saved for offline`
  if (!online) {
    return `Offline · ${count}`
  }
  if (status.kind === 'saving') {
    return status.total === 0
      ? 'Checking for new lyrics…'
      : `Saving lyrics… ${status.done} of ${status.total}`
  }
  if (status.kind === 'error') {
    return `Couldn't update · ${count}`
  }
  const failed =
    status.failed > 0 ? ` · ${status.failed} couldn't be saved` : ''
  return status.syncedAt === null
    ? `${count}${failed}`
    : `${count} · Updated ${ago(status.syncedAt)}${failed}`
}

export const useLyricsShelf = () => {
  const { data: songs = [], isPending } = useOfflineSongs()
  const favourites = useAtomValue(favoritesAtom)
  const history = useAtomValue(historyAtom)
  const status = useSyncStatus()
  const online = useOnline()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    requestSync()
    // Asks the browser not to clear the saved songs to free space; here, where the request makes sense
    void navigator.storage?.persist?.()
  }, [])

  // Each saved song with the lists it is on, newest first: by when you generated it for your own songs, by
  // when it was first generated for the rest
  const shelf = useMemo(() => {
    const mine = new Map(
      readMySongs().map((song) => [song.videoId, song.generatedAt])
    )
    const bookmarked = new Set(favourites.map((song) => song.videoId))
    const recent = new Set(
      history.slice(0, RECENT_LIMIT).map((song) => song.videoId)
    )
    return songs
      .map((song) => {
        const sources = new Set<OfflineSource>()
        if (mine.has(song.videoId)) {
          sources.add('mine')
        }
        if (bookmarked.has(song.videoId)) {
          sources.add('bookmark')
        }
        if (recent.has(song.videoId)) {
          sources.add('recent')
        }
        return {
          entry: indexSong(song),
          sortAt: mine.get(song.videoId) ?? song.generatedAt,
          sources,
        }
      })
      .filter(({ sources }) => sources.size > 0)
      .toSorted((a, b) => b.sortAt - a.sortAt)
  }, [songs, favourites, history])

  const results = useMemo(() => {
    const inFilter = shelf.filter(
      ({ sources }) => filter === 'all' || sources.has(filter)
    )
    const byId = new Map(
      inFilter.map((item) => [item.entry.song.videoId, item] as const)
    )
    return searchSongs(
      inFilter.map(({ entry }) => entry),
      deferredQuery
    ).flatMap(({ song, match }) => {
      const item = byId.get(song.videoId)
      return item === undefined ? [] : [{ ...item, match }]
    })
  }, [shelf, filter, deferredQuery])

  return {
    deferredQuery,
    filter,
    isPending,
    online,
    query,
    results,
    saved: shelf.length,
    setFilter,
    setQuery,
    status,
  }
}

type LyricsShelf = ReturnType<typeof useLyricsShelf>

// How long the saved-songs count stays under the title once nothing is changing
const STATUS_SHOWN_MS = 4000

// The sync status. Saving, offline and errors stay; the settled "N songs saved" line shows for a few seconds,
// then folds away so the list starts higher
export const SyncStatusLine = ({
  shelf: { status, online, saved },
  spacingClassName,
}: {
  shelf: LyricsShelf
  spacingClassName?: string
}) => {
  const lasting = !online || status.kind !== 'idle' || status.failed > 0
  // What the line says, without "Updated … ago", which changes on its own as time passes
  const state = `${online}-${status.kind}-${status.kind === 'saving' ? '' : status.syncedAt}-${saved}`
  const [folded, setFolded] = useState<string | null>(null)
  useEffect(() => {
    const timer = lasting
      ? undefined
      : setTimeout(() => {
          setFolded(state)
        }, STATUS_SHOWN_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [state, lasting])
  const shown = lasting || folded !== state
  return (
    <div data-folded={shown ? undefined : true} className='fold'>
      <p
        aria-live='polite'
        className='min-h-0 overflow-hidden text-xs text-muted-foreground'>
        {/* Spacing goes inside the clipped line, so it folds away with the text */}
        <span
          className={cn(
            'flex items-center justify-center gap-1',
            spacingClassName
          )}>
          {online ? null : <CloudOffIcon className='size-3.5 shrink-0' />}
          {statusText(status, online, saved)}
        </span>
      </p>
    </div>
  )
}

// The search field and the list chips. `chipsClassName` lets the page bleed the chip row to the screen edges
export const ShelfControls = ({
  shelf: { query, setQuery, filter, setFilter },
  chipsClassName,
}: {
  shelf: LyricsShelf
  chipsClassName?: string
}) => (
  <>
    <label className='relative block'>
      <span className='sr-only'>Search Saved Songs</span>
      <SearchIcon className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
      <input
        type='search'
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
        }}
        placeholder='Title, artist, romaji or a lyric'
        enterKeyHint='search'
        autoComplete='off'
        className='h-10 w-full rounded-full border border-border bg-card pr-10 pl-9 text-base text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none [&::-webkit-search-cancel-button]:hidden'
      />
      {query !== '' && (
        <button
          type='button'
          aria-label='Clear Search'
          onClick={() => {
            setQuery('')
          }}
          className='absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground'>
          <XIcon className='size-4' />
        </button>
      )}
    </label>
    <fieldset
      aria-label='Lists'
      className={cn(
        'no-scrollbar flex gap-1.5 overflow-x-auto',
        chipsClassName
      )}>
      {FILTERS.map((item) => (
        <button
          key={item.id}
          type='button'
          aria-pressed={filter === item.id}
          onClick={() => {
            setFilter(item.id)
          }}
          className={cn(
            'flex h-8 shrink-0 items-center rounded-full px-3 text-sm font-medium transition-colors',
            filter === item.id
              ? 'bg-foreground text-background'
              : 'bg-card text-foreground hover:bg-accent'
          )}>
          {item.label}
        </button>
      ))}
    </fieldset>
  </>
)

// The songs, each opening its reader; `onOpen` runs as one is picked (the menu closes itself)
export const ShelfResults = ({
  shelf: { results, isPending, filter, deferredQuery },
  onOpen,
}: {
  shelf: LyricsShelf
  onOpen?: () => void
}) => {
  if (results.length > 0) {
    return (
      <ul className='grid grid-cols-1'>
        {results.map(({ entry, sources, sortAt, match }) => (
          <OfflineSongRow
            key={entry.song.videoId}
            song={entry.song}
            sources={sources}
            sortAt={sortAt}
            match={match}
            onOpen={onOpen}
          />
        ))}
      </ul>
    )
  }
  if (isPending) {
    return null
  }
  const searching = deferredQuery.trim() !== ''
  return (
    <p className='px-2 py-10 text-center text-sm text-muted-foreground'>
      {searching
        ? `No saved songs match “${deferredQuery.trim()}”.`
        : FILTERS.find((item) => item.id === filter)?.empty}
      {filter === 'all' && !searching && (
        <span className='mt-2 block'>
          Songs you generate while signed in, bookmark, or open are saved here
          whenever you are online, for reading without a connection.
        </span>
      )}
    </p>
  )
}
