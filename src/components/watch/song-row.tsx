import type { ReactNode } from 'react'
import { Link } from 'react-router'

import {
  KaraokeCornerMark,
  KaraokeLabelMark,
} from '@/components/shared/karaoke-badge'
import type { ListSong } from '@/lib/listening/model'
import { songPath } from '@/lib/listening/store'
import { cn } from '@/utils/cn'

// A song in a list: a 96×54 thumbnail (16:9) with the karaoke corner, then the title on up to two lines and
// the channel, the whole row opening the song. `lead` sits before the picture (a drag handle, a number),
// `actions` after the text. Rows are 8px padded; the thumbnail's 4px corners plus that padding make the
// row's 12px ones
export const SongRow = ({
  song,
  lead,
  actions,
  current = false,
  onOpen,
  className,
  as: Root = 'li',
}: {
  song: ListSong
  lead?: ReactNode
  actions?: ReactNode
  // The song playing now: marked, and not a link to itself
  current?: boolean
  onOpen?: () => void
  className?: string
  // A row inside another list item (a sortable row) is a div
  as?: 'li' | 'div'
}) => {
  const body = (
    <>
      <span className='relative aspect-video w-24 shrink-0 overflow-hidden rounded-sm bg-thumbnail-placeholder'>
        <img
          src={song.thumbnailUrl}
          alt=''
          width='320'
          height='180'
          loading='lazy'
          decoding='async'
          className='size-full object-cover'
        />
        <KaraokeCornerMark videoId={song.videoId} size='sm' />
      </span>
      <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span
          className={cn(
            'line-clamp-2 text-sm leading-5 font-medium text-pretty',
            current ? 'text-primary-text' : 'text-foreground'
          )}>
          {song.title}
          <KaraokeLabelMark videoId={song.videoId} />
        </span>
        <span className='truncate text-xs text-muted-foreground'>
          {song.author}
        </span>
      </span>
    </>
  )
  return (
    <Root
      className={cn(
        'group/row flex items-center gap-1 rounded-xl transition-colors has-[a:hover]:bg-accent',
        current && 'bg-accent',
        className
      )}>
      {lead}
      {current ? (
        <div
          aria-current='true'
          className='flex min-w-0 flex-1 items-center gap-3 p-2'>
          {body}
        </div>
      ) : (
        <Link
          to={songPath(song.videoId)}
          state={{ videoId: song.videoId }}
          onClick={onOpen}
          className='flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
          {body}
        </Link>
      )}
      {actions}
    </Root>
  )
}
