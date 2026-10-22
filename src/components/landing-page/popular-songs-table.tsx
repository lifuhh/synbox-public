import { PlayIcon } from 'lucide-react'
import type React from 'react'
import { Link } from 'react-router'

import {
  KaraokeThumbBadgeMark,
  KaraokeLabelMark,
} from '@/components/shared/karaoke-badge'
import LoadError from '@/components/shared/load-error'
import { Skeleton } from '@/components/ui/skeleton'
import { useGetChartsPlaylist } from '@/lib/react-query/queries-and-mutations'
import type { CssVars } from '@/types'

// A row: rank, a 72×41 thumbnail (16:9), then the title on up to two 20px lines. 12 px apart inside a row; rows
// are 4 px padded top and bottom and 2 px apart, so six fit beside the recommendations. The rank starts 16px in,
// on the footer's first letter, and the play cue ends 16px from the other edge. The list starts 2 px down so the
// first row's karaoke mic, floating over its thumbnail's corner, isn't cut off
const ROW_PITCH_PX = 41 + 8 + 2

// Placeholder rows, varied in title width so the column doesn't read as a block
const SKELETON_TITLES = [
  <Skeleton key='a' className='h-3.5 w-5/6' />,
  <Skeleton key='b' className='h-3.5 w-2/3' />,
  <Skeleton key='c' className='h-3.5 w-11/12' />,
  <Skeleton key='d' className='h-3.5 w-3/5' />,
  <Skeleton key='e' className='h-3.5 w-3/4' />,
  <Skeleton key='f' className='h-3.5 w-4/5' />,
  <Skeleton key='g' className='h-3.5 w-2/3' />,
]

interface SongRowProps {
  rank: number
  song: {
    title: string
    vidURL: string
  }
}

// The whole row opens the song. The picture leads, because many titles are in Japanese; the title wraps to two
// lines rather than scrolling on hover
const SongRow = ({ rank, song }: SongRowProps) => (
  <li>
    <Link
      data-bench='charts-row'
      to={`/v/${song.vidURL}`}
      className='group flex items-center gap-3 rounded-xl px-2 py-1 text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
      <span className='w-5 shrink-0 text-sm font-medium text-muted-foreground tabular-nums'>
        {rank}
      </span>
      <span className='relative aspect-video w-18 shrink-0 rounded-sm bg-thumbnail-placeholder'>
        <img
          src={`https://i.ytimg.com/vi/${song.vidURL}/mqdefault.jpg`}
          alt=''
          width='320'
          height='180'
          loading='lazy'
          decoding='async'
          className='size-full rounded-sm object-cover'
        />
        <KaraokeThumbBadgeMark videoId={song.vidURL} />
      </span>
      <span className='line-clamp-2 min-w-0 flex-1 text-sm leading-5 text-pretty'>
        {song.title}
      </span>
      <KaraokeLabelMark videoId={song.vidURL} />
      {/* A pointer's cue that the row plays; on touch the title gets the room */}
      <PlayIcon
        aria-hidden
        className='size-4 shrink-0 fill-current text-muted-foreground transition-colors group-hover:text-foreground touch:hidden'
      />
    </Link>
  </li>
)

// Four rows and part of a fifth, so the cut-off row shows the list scrolls. Beside the recommendations (lg) the
// card instead runs exactly as tall as their row, from the centred card's picture to its channel line (the
// margins skip the row's 2px top and 6px bottom padding, carousel-track), so the two read as one band
const LIST_VARS: CssVars = {
  '--charts-list-h': `${4 * ROW_PITCH_PX + 28}px`,
}

const LandingPageCharts: React.FC = () => {
  const {
    data: chartsData,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useGetChartsPlaylist()

  return (
    <section
      aria-labelledby='charts-title'
      data-bench='charts'
      aria-busy={isLoading}
      className='flex flex-col gap-3 in-data-rise:rise-in in-data-rise:rise-delay-400 lg:w-100 lg:shrink-0'>
      <h2
        id='charts-title'
        className='flex min-h-9 items-center px-4 text-xl font-semibold tracking-tight text-foreground md:px-0 touch:min-h-0'>
        YouTube Charts
      </h2>
      <div className='mx-4 rounded-xl bg-card p-2 md:mx-0 lg:mt-0.5 lg:mb-1.5 lg:flex lg:grow lg:flex-col'>
        <div
          className='no-scrollbar h-(--charts-list-h) overflow-y-auto mask-fade-end lg:h-0 lg:grow'
          style={LIST_VARS}>
          {isError && (
            <LoadError
              message="Couldn't load the YouTube charts."
              retrying={isFetching}
              onRetry={() => {
                void refetch()
              }}
              className='h-full'
            />
          )}
          {!isError && isLoading && (
            <ul aria-hidden className='flex flex-col gap-0.5 pt-0.5'>
              {SKELETON_TITLES.map((title) => (
                <li
                  key={title.key}
                  className='flex items-center gap-3 px-2 py-1'>
                  <span className='w-5 shrink-0' />
                  <Skeleton shape='thumbnail' className='aspect-video w-18' />
                  <span className='flex-1'>{title}</span>
                </li>
              ))}
            </ul>
          )}
          {!isError && !isLoading && (
            <ul className='flex appear flex-col gap-0.5 pt-0.5'>
              {chartsData?.map((song, index) => (
                <SongRow
                  key={`${song.title}-${index}`}
                  rank={index + 1}
                  song={{ title: song.title, vidURL: song.id }}
                />
              ))}
            </ul>
          )}
        </div>
        <p className='mx-2 mt-1 mb-1 truncate text-sm text-song-channel'>
          YouTube Top 100 Japan
        </p>
      </div>
    </section>
  )
}

export default LandingPageCharts
