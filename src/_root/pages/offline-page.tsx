import { useAtomValue } from 'jotai'
import { CloudOffIcon, SearchIcon, XIcon } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'

import { OfflineSongRow } from '@/components/offline/offline-song-row'
import { favoritesAtom, historyAtom } from '@/context/atoms'
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

const OfflinePage = () => {
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

  const emptyText = (() => {
    if (deferredQuery.trim() !== '') {
      return `No saved songs match “${deferredQuery.trim()}”.`
    }
    return FILTERS.find((item) => item.id === filter)?.empty ?? ''
  })()

  return (
    <section className='flex custom-scrollbar flex-1 flex-col overflow-y-auto overscroll-contain pr-(--safe-right) pb-page-bottom pl-(--safe-left)'>
      <title>Lyrics · Synbox</title>
      <header className='mx-auto w-full max-w-xl px-4 pt-(--topbar-h) text-center'>
        <h1 className='pt-2 text-base font-semibold text-foreground'>Lyrics</h1>
        <p
          aria-live='polite'
          className='flex items-center justify-center gap-1 text-xs text-muted-foreground'>
          {online ? null : <CloudOffIcon className='size-3.5 shrink-0' />}
          {statusText(status, online, shelf.length)}
        </p>
      </header>

      <div className='sticky top-(--topbar-h) z-10 bg-background/85 backdrop-blur-md'>
        <div className='mx-auto flex w-full max-w-xl flex-col gap-2 px-4 py-2'>
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
              className='h-10 w-full rounded-full border border-white/10 bg-white/5 pr-10 pl-9 text-base text-foreground placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none [&::-webkit-search-cancel-button]:hidden'
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
            className='-mx-4 no-scrollbar flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0'>
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type='button'
                aria-pressed={filter === item.id}
                onClick={() => {
                  setFilter(item.id)
                }}
                className={cn(
                  'flex h-8 shrink-0 items-center rounded-full border px-3 text-sm font-medium transition-colors',
                  filter === item.id
                    ? 'border-transparent bg-foreground text-background'
                    : 'border-white/15 text-foreground hover:bg-white/10'
                )}>
                {item.label}
              </button>
            ))}
          </fieldset>
        </div>
      </div>

      <div className='mx-auto w-full max-w-xl px-2'>
        {results.length > 0 ? (
          <ul className='grid grid-cols-1'>
            {results.map(({ entry, sources, sortAt, match }) => (
              <OfflineSongRow
                key={entry.song.videoId}
                song={entry.song}
                sources={sources}
                sortAt={sortAt}
                match={match}
              />
            ))}
          </ul>
        ) : (
          !isPending && (
            <p className='px-2 py-10 text-center text-sm text-muted-foreground'>
              {emptyText}
              {filter === 'all' && deferredQuery.trim() === '' && (
                <span className='mt-2 block'>
                  Songs you generate while signed in, bookmark, or open are
                  saved here whenever you are online, for reading without a
                  connection.
                </span>
              )}
            </p>
          )
        )}
      </div>
    </section>
  )
}

export default OfflinePage
