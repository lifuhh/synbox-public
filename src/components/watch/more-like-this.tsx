import type { ListSong } from '@/lib/listening/model'

import { SongCard } from './song-card'

// Songs like this one past the few in Up Next, as cards in a grid
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
          <SongCard key={song.videoId} song={song} />
        ))}
      </ul>
    </section>
  )
