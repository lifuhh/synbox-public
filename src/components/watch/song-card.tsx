import { PlayIcon } from 'lucide-react'
import { Link } from 'react-router'

import { ListenCount } from '@/components/shared/listen-count'
import type { ListSong } from '@/lib/listening/model'
import { songPath } from '@/lib/listening/store'
import { bracketStart } from '@/utils'
import { cn } from '@/utils/cn'

import { SongMenu } from './song-menu'

// A picture-first song card (the gallery's), with its menu: the rows under the song on the watch page
// Positioned so its sr-only title stays inside a row's scroll box: unpositioned, the title escaped the row's clip and
// widened the page by the row's hidden cards
export const SongCard = ({
  song,
  className,
}: {
  song: ListSong
  className?: string
}) => (
  <li className={cn('relative flex min-w-0 flex-col', className)}>
    <Link
      to={songPath(song.videoId)}
      state={{ videoId: song.videoId }}
      className='group rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
      <span className='relative block aspect-video overflow-hidden rounded-xl bg-thumbnail-placeholder'>
        {/* 480x360, its letterbox cropped away: enough for a card at 3x without the 1280x720 decode */}
        <img
          src={`https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`}
          alt=''
          width='320'
          height='180'
          loading='lazy'
          decoding='async'
          className='size-full object-cover transition-transform duration-500 group-hover:scale-104 motion-reduce:transition-none'
        />
        <span className='absolute right-2 bottom-2 grid size-9 place-items-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100'>
          <PlayIcon className='size-4 fill-current' aria-hidden />
        </span>
      </span>
      <span className='sr-only'>{song.title}</span>
    </Link>
    <div className='mt-2 flex items-start gap-1'>
      {/* The words open the song too; the picture's link is the one a keyboard and a screen reader meet */}
      <Link
        to={songPath(song.videoId)}
        state={{ videoId: song.videoId }}
        tabIndex={-1}
        aria-hidden
        className='min-w-0 flex-1'>
        <p
          className={cn(
            'line-clamp-2 text-sm leading-5 font-medium wrap-anywhere text-foreground',
            bracketStart(song.title)
          )}>
          {song.title}
        </p>
        <p className='flex min-w-0 items-center gap-2.5 text-xs text-muted-foreground'>
          <ListenCount videoId={song.videoId} />
          <span className={cn('truncate', bracketStart(song.author))}>
            {song.author}
          </span>
        </p>
      </Link>
      <div className='-me-2 -mt-2'>
        <SongMenu song={song} />
      </div>
    </div>
  </li>
)
