import { PlayIcon } from 'lucide-react'
import { Link } from 'react-router'

import {
  KaraokeCornerMark,
  KaraokeLabelMark,
} from '@/components/shared/karaoke-badge'
import type { ListSong } from '@/lib/listening/model'
import { songPath } from '@/lib/listening/store'
import { cn } from '@/utils/cn'

import { SongMenu } from './song-menu'

// Songs like this one past the few in Up Next, as picture-first cards (the gallery's), each with its menu
export const MoreLikeThis = ({
  songs,
  className,
}: {
  songs: ListSong[]
  className?: string
}) =>
  songs.length === 0 ? null : (
    <section aria-labelledby='more-like-this-title' className={className}>
      <h2 id='more-like-this-title' className='mb-3 text-base font-semibold'>
        More Like This
      </h2>
      <ul className='grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3'>
        {songs.map((song) => (
          <li key={song.videoId} className='flex min-w-0 flex-col'>
            <Link
              to={songPath(song.videoId)}
              state={{ videoId: song.videoId }}
              className='group rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
              <span className='relative block aspect-video overflow-hidden rounded-xl bg-thumbnail-placeholder'>
                <img
                  src={song.thumbnailUrl}
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
                <KaraokeCornerMark videoId={song.videoId} />
              </span>
              <span className='sr-only'>
                {song.title}
                <KaraokeLabelMark videoId={song.videoId} />
              </span>
            </Link>
            <div className='mt-2 flex items-start gap-1'>
              <div className={cn('min-w-0 flex-1')}>
                <p className='line-clamp-2 text-sm leading-5 font-medium text-foreground'>
                  {song.title}
                </p>
                <p className='truncate text-xs text-muted-foreground'>
                  {song.author}
                </p>
              </div>
              <div className='-me-2 -mt-2'>
                <SongMenu song={song} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
