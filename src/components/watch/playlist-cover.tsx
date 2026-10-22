import { ListMusicIcon } from 'lucide-react'

import type { Playlist } from '@/lib/listening/model'
import { cn } from '@/utils/cn'

// A playlist's picture: its first song's thumbnail, or four of them in a square once it has four
export const PlaylistCover = ({
  playlist,
  className,
}: {
  playlist: Playlist
  className?: string
}) => {
  const pictures = playlist.songs.map((song) => song.thumbnailUrl)
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 overflow-hidden rounded-lg bg-thumbnail-placeholder',
        pictures.length >= 4 && 'grid-cols-2 grid-rows-2',
        className
      )}>
      {pictures.length === 0 ? (
        <ListMusicIcon className='m-auto size-1/3 text-muted-foreground' />
      ) : (
        pictures.slice(0, pictures.length >= 4 ? 4 : 1).map((src, index) => (
          <img
            // The pictures are positional in a fixed grid
            // oxlint-disable-next-line no-array-index-key
            key={index}
            src={src}
            alt=''
            loading='lazy'
            className='size-full object-cover'
          />
        ))
      )}
    </span>
  )
}
