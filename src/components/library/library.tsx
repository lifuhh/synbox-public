import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { CloudOffIcon, SearchIcon, XIcon } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { Link } from 'react-router'
import { toRomaji } from 'wanakana'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PlaylistCover } from '@/components/watch/playlist-cover'
import { SongRow } from '@/components/watch/song-row'
import { useMe } from '@/lib/auth'
import {
  clearHistoryAtom,
  favoritesAtom,
  historyAtom,
  removeFavoriteAtom,
} from '@/lib/library/store'
import type { ListSong, Playlist } from '@/lib/listening/model'
import { usePlaylists } from '@/lib/listening/store'
import { fold, indexSong, searchSongs } from '@/lib/offline/search'
import type { SearchIndexEntry, SearchResult } from '@/lib/offline/search'
import type { OfflineSong } from '@/lib/offline/song'
import type { SyncStatus } from '@/lib/offline/sync'
import {
  readMySongs,
  requestSync,
  useOfflineSongs,
  useSyncStatus,
} from '@/lib/offline/sync'
import { useOnline } from '@/lib/pwa'
import { cn } from '@/utils/cn'

// The user's own songs, in one place: the top bar's Library menu and the installed app's Library tab. Three
// lists of songs they keep (Bookmarks, Playlists, the songs they Generated) and one of what they played
// (History). Online a song opens its player; offline, only songs whose lyrics are saved on this device show, and
// each opens its reader

export type LibraryTab = 'bookmarks' | 'playlists' | 'generated' | 'history'

const TABS: { id: LibraryTab; label: string; empty: string }[] = [
  {
    empty: 'Bookmark a song from its player.',
    id: 'bookmarks',
    label: 'Bookmarks',
  },
  {
    empty: 'Save a song to a playlist from its menu.',
    id: 'playlists',
    label: 'Playlists',
  },
  {
    empty: 'Songs you generate show up here.',
    id: 'generated',
    label: 'Generated',
  },
  { empty: 'Songs you play show up here.', id: 'history', label: 'History' },
]

const isLibraryTab = (value: string): value is LibraryTab =>
  TABS.some((tab) => tab.id === value)

// Kept while the app is open, so the menu and the page reopen where they were left; a new visit starts on
// Bookmarks
const libraryTabAtom = atom<LibraryTab>('bookmarks')

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

// A song known only from its lyrics saved on this device (one the account generated)
const listSongOf = (song: OfflineSong): ListSong => ({
  author: song.author,
  thumbnailUrl: song.thumbnail ?? '',
  title: song.title,
  videoId: song.videoId,
})

const entryOf = (
  song: ListSong,
  index: Map<string, SearchIndexEntry>
): SearchIndexEntry<ListSong> => {
  const saved = index.get(song.videoId)
  return saved === undefined
    ? {
        artist: [fold(song.author), fold(toRomaji(song.author))],
        lines: [],
        song,
        title: [fold(song.title)],
      }
    : // The list's own title too, in case it differs from the saved lyrics'
      { ...saved, song, title: [...saved.title, fold(song.title)] }
}

const playlistMatches = (playlist: Playlist, query: string) => {
  const name = fold(playlist.name)
  return query
    .split(/\s+/u)
    .map(fold)
    .filter(Boolean)
    .every((term) => name.includes(term))
}

export const useLibrary = () => {
  const { data: offline = [], isPending } = useOfflineSongs()
  const bookmarks = useAtomValue(favoritesAtom)
  const history = useAtomValue(historyAtom)
  const playlists = usePlaylists()
  const { data: me } = useMe()
  const status = useSyncStatus()
  const online = useOnline()
  const [chosenTab, setTab] = useAtom(libraryTabAtom)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    requestSync()
    // Asks the browser not to clear the saved songs to free space; here, where the request makes sense
    void navigator.storage?.persist?.()
  }, [])

  // Each song with its lyrics saved on this device, indexed once for searching its title, artist and lines
  const saved = useMemo(
    () => new Map(offline.map((song) => [song.videoId, indexSong(song)])),
    [offline]
  )
  // Generated while signed in, newest first; titles come from the saved lyrics. `offline` is a dependency:
  // a sync rewrites the account's list before it saves their lyrics
  const generated = useMemo(() => {
    const songs = new Map(offline.map((song) => [song.videoId, song]))
    return readMySongs()
      .toSorted((a, b) => b.generatedAt - a.generatedAt)
      .flatMap(({ videoId }) => {
        const song = songs.get(videoId)
        return song === undefined ? [] : [listSongOf(song)]
      })
  }, [offline])
  const showGenerated = (me?.user ?? null) !== null || generated.length > 0
  const tabs = TABS.filter((tab) => tab.id !== 'generated' || showGenerated)
  const tab = tabs.some(({ id }) => id === chosenTab) ? chosenTab : 'bookmarks'

  const songs = useMemo(() => {
    const find = (list: ListSong[]): SearchResult<ListSong>[] =>
      searchSongs(
        list
          .filter((song) => online || saved.has(song.videoId))
          .map((song) => entryOf(song, saved)),
        deferredQuery
      )
    return {
      bookmarks: find(bookmarks.toReversed()),
      generated: find(generated),
      history: find(history),
    }
  }, [bookmarks, generated, history, saved, online, deferredQuery])
  const shownPlaylists = playlists.filter((playlist) =>
    playlistMatches(playlist, deferredQuery)
  )

  return {
    deferredQuery,
    hasHistory: history.length > 0,
    isPending,
    online,
    playlists: shownPlaylists,
    query,
    saved,
    savedCount: offline.length,
    setQuery,
    setTab,
    songs,
    status,
    tab,
    tabs,
  }
}

type Library = ReturnType<typeof useLibrary>

// How long the saved-songs count shows once nothing is changing
const STATUS_SHOWN_MS = 4000

// The offline copy's state. Saving, offline and errors stay; the settled "N songs saved" line shows for a few
// seconds, then folds away so the list starts higher
export const SyncStatusLine = ({
  library: { status, online, savedCount },
  className,
}: {
  library: Library
  className?: string
}) => {
  const lasting = !online || status.kind !== 'idle' || status.failed > 0
  // What the line says, without "Updated … ago", which changes on its own as time passes
  const state = `${online}-${status.kind}-${status.kind === 'saving' ? '' : status.syncedAt}-${savedCount}`
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
          className={cn('flex items-center justify-center gap-1', className)}>
          {online ? null : <CloudOffIcon className='size-3.5 shrink-0' />}
          {statusText(status, online, savedCount)}
        </span>
      </p>
    </div>
  )
}

const SearchField = ({
  library: { query, setQuery },
}: {
  library: Library
}) => (
  <label className='relative block'>
    <span className='sr-only'>Search Library</span>
    <SearchIcon className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
    <input
      type='search'
      value={query}
      onChange={(event) => {
        setQuery(event.target.value)
      }}
      placeholder='Title, artist or a lyric'
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
)

const Empty = ({ children }: { children: ReactNode }) => (
  <p className='px-4 py-10 text-center text-sm text-pretty text-muted-foreground'>
    {children}
  </p>
)

// Why a list is empty: the search, being offline, or nothing in it yet
const emptyText = (library: Library, tab: LibraryTab) => {
  const query = library.deferredQuery.trim()
  if (query !== '') {
    return `No matches for “${query}”.`
  }
  if (!library.online && tab !== 'playlists') {
    return 'Nothing here is saved for offline.'
  }
  return TABS.find(({ id }) => id === tab)?.empty
}

// Bookmarks are `removable`: each row has its own Remove button beside the link
const SongList = ({
  library,
  results,
  onOpen,
  removable,
}: {
  library: Library
  results: SearchResult<ListSong>[]
  onOpen?: () => void
  removable: boolean
}) => {
  const removeFavorite = useSetAtom(removeFavoriteAtom)
  return (
    <ul className='flex flex-col'>
      {results.map(({ song, match }) => {
        const offline = library.online
          ? undefined
          : library.saved.get(song.videoId)
        return (
          <SongRow
            key={song.videoId}
            song={song}
            onOpen={onOpen}
            to={offline === undefined ? undefined : `/lyrics/${song.videoId}`}
            picture={offline === undefined ? undefined : offline.song.thumbnail}
            note={match?.kind === 'lyrics' ? match.line : undefined}
            actions={
              removable ? (
                <Button
                  variant='row-icon'
                  size='icon'
                  className='mr-1 shrink-0 touch:size-11'
                  onClick={() => {
                    removeFavorite(song.videoId)
                  }}>
                  <XIcon className='size-4' />
                  <span className='sr-only'>
                    Remove {song.title} from Bookmarks
                  </span>
                </Button>
              ) : undefined
            }
          />
        )
      })}
    </ul>
  )
}

// The library, laid out as a menu (a popover's lists scroll inside it, all as tall as the longest so switching
// tabs doesn't resize it) or as a page (a title, then controls that stick under the top bar; `headerRef` and
// `barRef` let the page tell when they have stuck). `onLeave` closes the menu as a song or playlist opens, or
// as Clear History asks; `onReturn` brings it back once that is answered
export const LibraryView = ({
  variant,
  headerRef,
  barRef,
  onLeave,
  onReturn,
}: {
  variant: 'menu' | 'page'
  headerRef?: Ref<HTMLElement>
  barRef?: Ref<HTMLDivElement>
  onLeave?: () => void
  onReturn?: () => void
}) => {
  const library = useLibrary()
  const clearHistory = useSetAtom(clearHistoryAtom)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const menu = variant === 'menu'
  const searching = library.deferredQuery.trim() !== ''

  const panel = cn(
    'mt-0 flex flex-col',
    menu && 'min-h-0 [grid-area:1/1] data-[state=inactive]:invisible',
    !menu && 'mx-auto w-full max-w-xl'
  )
  const list = menu
    ? 'min-h-0 overflow-y-auto overscroll-contain p-2'
    : 'px-2 py-1'
  const footer = menu
    ? 'flex justify-end border-t border-border p-2'
    : 'flex justify-end px-2 py-2'

  const songsOf = (tab: Exclude<LibraryTab, 'playlists'>) => {
    const results = library.songs[tab]
    if (results.length === 0) {
      return library.isPending ? null : <Empty>{emptyText(library, tab)}</Empty>
    }
    return (
      <div className={list}>
        <SongList
          library={library}
          results={results}
          onOpen={onLeave}
          removable={tab === 'bookmarks'}
        />
      </div>
    )
  }

  return (
    <Tabs
      value={library.tab}
      onValueChange={(value) => {
        if (isLibraryTab(value)) {
          library.setTab(value)
        }
      }}
      className={cn('flex flex-col', menu && 'min-h-0')}>
      {!menu && (
        <header
          ref={headerRef}
          className='mx-auto w-full max-w-xl px-4 pt-page-top pb-1 text-center'>
          <h1 className='text-base font-semibold text-foreground'>Library</h1>
          <SyncStatusLine library={library} />
        </header>
      )}
      <div ref={barRef} className={menu ? 'p-3 pb-1' : 'sticky-under-topbar'}>
        <div
          className={cn(
            'flex flex-col gap-2',
            !menu && 'mx-auto w-full max-w-xl px-4 py-2'
          )}>
          {menu && <SyncStatusLine library={library} className='pb-1' />}
          <SearchField library={library} />
          <TabsList
            aria-label='Library'
            className='no-scrollbar grid h-10 w-full auto-cols-[minmax(max-content,1fr)] grid-flow-col justify-start overflow-x-auto touch:h-12'>
            {library.tabs.map(({ id, label }) => (
              <TabsTrigger key={id} value={id} className='h-full'>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </div>
      <div
        className={cn(
          menu &&
            'grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]'
        )}>
        {library.tabs.map(({ id }) => (
          <TabsContent
            key={id}
            value={id}
            forceMount={menu || undefined}
            className={panel}>
            {id === 'playlists' ? (
              <>
                {library.playlists.length > 0 ? (
                  <ul className={list}>
                    {library.playlists.map((playlist) => (
                      <li key={playlist.id}>
                        <Link
                          to={`/playlists/${playlist.id}`}
                          onClick={onLeave}
                          className='flex items-center gap-3 rounded-xl p-2 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
                          <PlaylistCover
                            playlist={playlist}
                            className='size-12'
                          />
                          <span className='flex min-w-0 flex-col gap-0.5'>
                            <span className='truncate text-sm font-medium text-foreground'>
                              {playlist.name}
                            </span>
                            <span className='text-xs text-muted-foreground'>
                              {playlist.songs.length === 1
                                ? '1 song'
                                : `${playlist.songs.length} songs`}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>{emptyText(library, 'playlists')}</Empty>
                )}
                <div className={footer}>
                  <Button asChild variant='ghost-subtle'>
                    <Link to='/playlists' onClick={onLeave}>
                      All Playlists
                    </Link>
                  </Button>
                </div>
              </>
            ) : (
              <>
                {songsOf(id)}
                {id === 'history' && library.hasHistory && !searching && (
                  <div className={footer}>
                    <Button
                      variant='ghost-subtle'
                      onClick={() => {
                        onLeave?.()
                        setConfirmingClear(true)
                      }}>
                      Clear History
                    </Button>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        ))}
      </div>
      {/* Either answer returns to the menu: Cancel to the list, Clear History to its empty state */}
      <AlertDialog
        open={confirmingClear}
        onOpenChange={(next) => {
          setConfirmingClear(next)
          if (!next) {
            onReturn?.()
          }
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear History?</AlertDialogTitle>
            <AlertDialogDescription>
              Every song you played leaves your history. You can&apos;t undo it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                clearHistory()
              }}>
              Clear History
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  )
}
