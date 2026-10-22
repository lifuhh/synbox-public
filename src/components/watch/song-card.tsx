import { PlayIcon } from 'lucide-react'
import { Link } from 'react-router'

import {
  KaraokePictureBadgeMark,
  KaraokeLabelMark,
} from '@/components/shared/karaoke-badge'
import type { ListSong } from '@/lib/listening/model'
import { songPath } from '@/lib/listening/store'
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
        <KaraokePictureBadgeMark videoId={song.videoId} />
      </span>
      <span className='sr-only'>
        {song.title}
        <KaraokeLabelMark videoId={song.videoId} />
      </span>
    </Link>
    <div className='mt-2 flex items-start gap-1'>
      <div className='min-w-0 flex-1'>
        <p className='line-clamp-2 text-sm leading-5 font-medium text-foreground'>
          {song.title}
        </p>
        <p className='truncate text-xs text-muted-foreground'>{song.author}</p>
      </div>
      <div className='-me-2 -mt-2'>
        <SongMenu song={song} />
      </div>
    </div>
  </li>
)
