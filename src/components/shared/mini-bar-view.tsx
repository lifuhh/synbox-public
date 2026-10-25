import { PauseIcon, PlayIcon, VolumeXIcon, XIcon } from 'lucide-react'
import type { MouseEvent, Ref } from 'react'
import { Link } from 'react-router'

import type { ListSong } from '@/lib/listening/model'
import { songPath, songState } from '@/lib/listening/store'
import { cn } from '@/utils/cn'

// The bar's thumbnail is rounded-lg
export const THUMB_RADIUS_PX = 8

// The mini bar as drawn: the bar itself (mini-bar.tsx) and its stand-in the drag to minimise lands on
// (minimise-ghost.tsx › MinimiseGhost), so the two share every box
export const MiniBarView = ({
  song,
  playing,
  ended = false,
  muted = false,
  thumbRef,
  lineRef,
  onOpen,
  onToggle,
  onUnmute,
  onClose,
}: {
  song: ListSong
  playing: boolean
  ended?: boolean
  muted?: boolean
  thumbRef?: Ref<HTMLSpanElement>
  lineRef?: Ref<HTMLSpanElement>
  onOpen?: (event: MouseEvent<HTMLAnchorElement>) => void
  onToggle?: () => void
  onUnmute?: () => void
  onClose?: () => void
}) => (
  <div className='relative flex h-14 items-center gap-1 overflow-hidden rounded-2xl bg-popover/90 p-1.5 shadow-lg ring-1 ring-white/10 backdrop-blur-xl'>
    <Link
      to={songPath(song.videoId)}
      state={songState(song.videoId, 'resume')}
      onClick={onOpen}
      className='flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
      <span
        ref={thumbRef}
        data-mini-thumb
        className='aspect-video h-11 shrink-0'>
        <img
          src={song.thumbnailUrl}
          alt=''
          className='size-full rounded-lg object-cover'
        />
      </span>
      <span className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate text-sm font-medium text-foreground'>
          {song.title}
        </span>
        <span className='truncate text-xs text-muted-foreground'>
          {song.author}
        </span>
      </span>
    </Link>
    {muted && (
      <button
        type='button'
        aria-label='Unmute'
        onClick={onUnmute}
        className='grid size-11 shrink-0 place-items-center rounded-full text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
        <VolumeXIcon className='size-5' aria-hidden />
      </button>
    )}
    <button
      type='button'
      aria-label={playing ? 'Pause' : 'Play'}
      onClick={onToggle}
      className='grid size-11 shrink-0 place-items-center rounded-full text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
      {playing ? (
        <PauseIcon className='size-5 fill-current' aria-hidden />
      ) : (
        <PlayIcon className='size-5 fill-current' aria-hidden />
      )}
    </button>
    <button
      type='button'
      aria-label='Close Player'
      onClick={onClose}
      className='grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
      <XIcon className='size-5' aria-hidden />
    </button>
    <span
      aria-hidden
      className='pointer-events-none absolute inset-x-3 bottom-0 h-0.5 overflow-hidden rounded-full bg-white/15'>
      <span
        ref={lineRef}
        className={cn(
          'block size-full origin-left scale-x-0 bg-foreground/80',
          ended && 'bg-foreground/40'
        )}
      />
    </span>
  </div>
)
