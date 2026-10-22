import { useAtom, useSetAtom } from 'jotai'
import { BookmarkIcon, PlayIcon, XIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import {
  KaraokeCornerMark,
  KaraokeLabelMark,
} from '@/components/shared/karaoke-badge'
import OptimizedThumbnail from '@/components/shared/optimized-thumbnail'
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { PlaylistCover } from '@/components/watch/playlist-cover'
import { favoritesAtom, historyAtom, removeFavoriteAtom } from '@/context/atoms'
import { useOverflow } from '@/hooks/use-overflow'
import { usePlaylists } from '@/lib/listening/store'

type SavedTab = 'bookmarks' | 'history' | 'playlists'

const isSavedTab = (value: string): value is SavedTab =>
  value === 'bookmarks' || value === 'history' || value === 'playlists'

interface Song {
  videoId: string
  title: string
  author: string
  thumbnailUrl: string
}

// One song: the thumbnail and text open its player; a trailing action may sit beside the link, not inside it
const SongRow = ({
  song,
  onOpen,
  action,
}: {
  song: Song
  onOpen: () => void
  action?: ReactNode
}) => {
  const textRef = useRef<HTMLSpanElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isOverflowing = useOverflow(textRef, containerRef)

  return (
    <li className='flex playlist-item items-center gap-1 rounded-md pr-1 hover:bg-accent has-focus-visible:bg-accent'>
      <Link
        to={`/v/${song.videoId}`}
        onClick={onOpen}
        className='flex min-w-0 grow items-center gap-2 rounded-md p-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
        <OptimizedThumbnail src={song.thumbnailUrl} alt=''>
          <KaraokeCornerMark videoId={song.videoId} size='sm' />
        </OptimizedThumbnail>
        <span className='min-w-0 grow'>
          <span
            ref={containerRef}
            className={`block font-bold tracking-wide text-song-title ${
              isOverflowing ? 'marquee' : 'overflow-hidden'
            }`}>
            <span ref={textRef} className='inline-block whitespace-nowrap'>
              {song.title}
            </span>
          </span>
          <KaraokeLabelMark videoId={song.videoId} />
          <span className='block truncate text-sm text-song-meta'>
            {song.author}
          </span>
        </span>
      </Link>
      {action}
    </li>
  )
}

const EmptyState = ({ title, body }: { title: string; body: string }) => (
  <div className='flex flex-col items-center gap-2 px-6 py-8 text-center'>
    <p className='text-lg font-medium text-foreground'>{title}</p>
    <p className='text-sm text-muted-foreground'>{body}</p>
  </div>
)

// Both panels share one grid cell, so the menu is as tall as the longer list and switching tabs doesn't
// resize it; the hidden one is invisible, which also takes it out of the tab order and the accessibility tree
const PANEL =
  'mt-0 flex min-h-0 flex-col [grid-area:1/1] data-[state=inactive]:invisible'
const LIST = 'min-h-0 overflow-y-auto overscroll-contain p-2'

// The top bar's one entry for songs to come back to: Bookmarks, and the History of songs played here
const SavedMenu = () => {
  const [open, setOpen] = useState(false)
  // Kept while the app is open, so the menu reopens where it was left; a new visit starts on Bookmarks
  const [tab, setTab] = useState<SavedTab>('bookmarks')
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [favorites] = useAtom(favoritesAtom)
  const [history, setHistory] = useAtom(historyAtom)
  const removeFavorite = useSetAtom(removeFavoriteAtom)
  const playlists = usePlaylists()

  const close = () => {
    setOpen(false)
  }

  return (
    <TooltipProvider>
      <Popover open={open} onOpenChange={setOpen} modal>
        <Tooltip>
          <PopoverTrigger asChild>
            <TooltipTrigger asChild>
              <Button variant='toolbar' size='icon'>
                {/* Filled while the menu is open, as a selected icon is */}
                <BookmarkIcon className='h-6 w-6 shrink-0 in-aria-expanded:fill-current' />
                <span className='sr-only'>Saved</span>
              </Button>
            </TooltipTrigger>
          </PopoverTrigger>
          <TooltipContent variant='accent'>Saved</TooltipContent>
        </Tooltip>
        <PopoverContent
          align='end'
          sideOffset={10}
          collisionPadding={8}
          variant='floating'
          aria-label='Saved'
          className='flex max-h-[min(38rem,calc(var(--radix-popover-content-available-height)-var(--safe-bottom)))] w-[min(25rem,calc(100vw-1rem-var(--safe-left)-var(--safe-right)))] flex-col overflow-hidden'>
          <Tabs
            value={tab}
            onValueChange={(value) => {
              if (isSavedTab(value)) {
                setTab(value)
              }
            }}
            className='flex min-h-0 flex-col'>
            <div className='p-2 pb-0'>
              <TabsList className='grid h-10 w-full grid-cols-3 touch:h-13'>
                <TabsTrigger value='bookmarks' className='h-full'>
                  Bookmarks
                </TabsTrigger>
                <TabsTrigger value='history' className='h-full'>
                  History
                </TabsTrigger>
                <TabsTrigger value='playlists' className='h-full'>
                  Playlists
                </TabsTrigger>
              </TabsList>
            </div>
            <div className='grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]'>
              <TabsContent value='bookmarks' forceMount className={PANEL}>
                {favorites.length > 0 ? (
                  <ul className={LIST}>
                    {favorites.toReversed().map((song) => (
                      <SongRow
                        key={song.videoId}
                        song={song}
                        onOpen={close}
                        action={
                          <Button
                            variant='row-icon'
                            size='icon'
                            className='shrink-0 touch:size-11'
                            onClick={() => {
                              removeFavorite(song.videoId)
                            }}>
                            <XIcon className='size-4' />
                            <span className='sr-only'>
                              Remove {song.title} from Bookmarks
                            </span>
                          </Button>
                        }
                      />
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    title='No bookmarks yet'
                    body='Bookmark a song from its player to keep it here.'
                  />
                )}
              </TabsContent>
              <TabsContent value='history' forceMount className={PANEL}>
                {history.length > 0 ? (
                  <>
                    <ul className={LIST}>
                      {history.map((song) => (
                        <SongRow
                          key={song.videoId}
                          song={song}
                          onOpen={close}
                          action={
                            <PlayIcon
                              aria-hidden
                              className='mx-2 size-6 shrink-0 fill-current text-muted-foreground'
                            />
                          }
                        />
                      ))}
                    </ul>
                    <div className='flex justify-end border-t border-border p-2'>
                      <Button
                        variant='ghost-subtle'
                        onClick={() => {
                          setOpen(false)
                          setConfirmingClear(true)
                        }}>
                        Clear History
                      </Button>
                    </div>
                  </>
                ) : (
                  <EmptyState
                    title='No history yet'
                    body='Songs you play show up here.'
                  />
                )}
              </TabsContent>
              <TabsContent value='playlists' forceMount className={PANEL}>
                {playlists.length > 0 ? (
                  <ul className={LIST}>
                    {playlists.map((list) => (
                      <li key={list.id}>
                        <Link
                          to={`/playlists/${list.id}`}
                          onClick={close}
                          className='flex items-center gap-2 rounded-md p-2 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
                          <PlaylistCover playlist={list} className='size-12' />
                          <span className='flex min-w-0 flex-col'>
                            <span className='truncate font-bold tracking-wide text-song-title'>
                              {list.name}
                            </span>
                            <span className='text-sm text-song-meta'>
                              {list.songs.length === 1
                                ? '1 song'
                                : `${list.songs.length} songs`}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    title='No playlists yet'
                    body='Save a song to a playlist from its menu or from the player.'
                  />
                )}
                <div className='flex justify-end border-t border-border p-2'>
                  <Button asChild variant='ghost-subtle'>
                    <Link to='/playlists' onClick={close}>
                      All Playlists
                    </Link>
                  </Button>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </PopoverContent>
      </Popover>
      {/* Either answer returns to the menu: Cancel to the list, Clear History to its empty state */}
      <AlertDialog
        open={confirmingClear}
        onOpenChange={(next) => {
          setConfirmingClear(next)
          if (!next) {
            setOpen(true)
          }
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear History?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes every song from your history on this device. You
              can&apos;t undo it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setHistory([])
              }}>
              Clear History
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  )
}

export default SavedMenu
