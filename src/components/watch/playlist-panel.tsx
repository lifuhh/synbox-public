import { useAtomValue } from 'jotai'
import { ChevronDownIcon, ShuffleIcon, XIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { contextNext } from '@/lib/listening/model'
import { contextAtom, useListening } from '@/lib/listening/store'
import { cn } from '@/utils/cn'

import { SongRow } from './song-row'

// The playlist being played, over Up Next, as YouTube shows one: its name and where in it the song is (or, while
// a queued song plays, what it goes on with), Shuffle, and every song in the order they play, the one playing
// marked and those played dimmed; a row plays that song and the playlist goes on from it. × stops playing the
// playlist (the song plays on). On a phone it folds to its header and the next song, to keep Up Next in reach
export const PlaylistPanel = ({
  videoId,
  foldable,
  large = false,
  className,
}: {
  videoId: string
  foldable: boolean
  large?: boolean
  className?: string
}) => {
  const context = useAtomValue(contextAtom)
  const { leavePlaylist, setShuffled } = useListening()
  const [open, setOpen] = useState(!foldable)
  const list = useRef<HTMLUListElement>(null)
  const playing =
    context?.order.findIndex((song) => song.videoId === videoId) ?? -1
  // The list's place: the song playing, or while a queued one plays the playlist's own last song
  const place = playing === -1 ? (context?.at ?? 0) : playing
  // That place at the top of the list's view, with the song before it showing: on a new song, a new order
  // (Shuffle) and when the list unfolds. The list is the rows' offset parent
  const order = context?.order
  useLayoutEffect(() => {
    const row = list.current?.children[Math.max(place - 1, 0)]
    if (open && order !== undefined && row instanceof HTMLElement) {
      list.current?.scrollTo({ top: row.offsetTop })
    }
  }, [place, open, order])
  if (context === null) {
    return null
  }
  const next = context.order[contextNext(context, videoId)]
  return (
    <section
      aria-label={`Playlist ${context.name}`}
      className={cn('overflow-hidden rounded-xl bg-card', className)}>
      <header className='flex items-center gap-1 py-2 ps-3 pe-1'>
        <div className='min-w-0 flex-1'>
          <Link
            to={`/playlists/${context.id}`}
            className='block truncate rounded-sm text-base font-semibold text-foreground hover:underline'>
            {context.name}
          </Link>
          <p className='truncate text-xs text-muted-foreground tabular-nums'>
            Playlist
            {playing !== -1 && ` · ${playing + 1}/${context.order.length}`}
            {(!open || playing === -1) &&
              next !== undefined &&
              ` · Next: ${next.title}`}
          </p>
        </div>
        <Button
          variant='toggle'
          size='icon-round'
          aria-label='Shuffle'
          aria-pressed={context.shuffled}
          onClick={() => {
            setShuffled(!context.shuffled)
          }}>
          <ShuffleIcon className='size-5' />
        </Button>
        {foldable && (
          <Button
            variant='ghost'
            size='icon-round'
            aria-label={open ? 'Hide Playlist' : 'Show Playlist'}
            aria-expanded={open}
            onClick={() => {
              setOpen(!open)
            }}>
            <ChevronDownIcon
              className={cn(
                'size-5 transition-transform',
                open && 'rotate-180'
              )}
            />
          </Button>
        )}
        <Button
          variant='ghost'
          size='icon-round'
          aria-label='Close Playlist'
          onClick={leavePlaylist}>
          <XIcon className='size-5' />
        </Button>
      </header>
      {open && (
        <ul
          ref={list}
          className='relative max-h-[min(24rem,50dvh)] overflow-y-auto overscroll-contain px-1 pb-1'>
          {context.order.map((song, index) => (
            <SongRow
              key={song.videoId}
              song={song}
              large={large}
              current={index === playing}
              played={
                index !== playing && context.played.includes(song.videoId)
              }
              lead={
                <span
                  aria-hidden
                  className={cn(
                    'w-6 shrink-0 text-center text-xs text-muted-foreground tabular-nums',
                    large && 'self-center'
                  )}>
                  {index === playing ? '▶' : index + 1}
                </span>
              }
            />
          ))}
        </ul>
      )}
    </section>
  )
}
