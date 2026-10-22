import { PlayIcon } from 'lucide-react'
import type React from 'react'
import { Link } from 'react-router'

import {
  KaraokeCornerMark,
  KaraokeLabelMark,
} from '@/components/shared/karaoke-badge'
import LoadError from '@/components/shared/load-error'
import { Skeleton } from '@/components/ui/skeleton'
import { useGetChartsPlaylist } from '@/lib/react-query/queries-and-mutations'
import type { CssVars } from '@/types'

// A row: rank, a 96×54 thumbnail (16:9), then the title. 12 px apart inside a row; rows are 8 px padded and
// 8 px apart, so neighbouring thumbnails sit 24 px apart, twice the gap inside a row
const ROW_PITCH_PX = 54 + 16 + 8

// Placeholder rows, varied in title width so the column doesn't read as a block
const SKELETON_TITLES = [
  <Skeleton key='a' className='h-3.5 w-5/6' />,
  <Skeleton key='b' className='h-3.5 w-2/3' />,
  <Skeleton key='c' className='h-3.5 w-11/12' />,
  <Skeleton key='d' className='h-3.5 w-3/5' />,
  <Skeleton key='e' className='h-3.5 w-3/4' />,
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
      to={`/v/${song.vidURL}`}
      className='group flex items-center gap-3 rounded-xl p-2 text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
      <span className='w-5 shrink-0 text-end text-sm font-medium text-muted-foreground tabular-nums'>
        {rank}
      </span>
      <span className='relative aspect-video w-24 shrink-0 overflow-hidden rounded-sm bg-thumbnail-placeholder max-[359px]:w-20'>
        <img
          src={`https://i.ytimg.com/vi/${song.vidURL}/mqdefault.jpg`}
          alt=''
          width='320'
          height='180'
          loading='lazy'
          decoding='async'
          className='size-full object-cover'
        />
        <KaraokeCornerMark videoId={song.vidURL} size='sm' />
      </span>
      <span className='line-clamp-2 min-w-0 flex-1 text-sm leading-5 text-pretty'>
        {song.title}
        <KaraokeLabelMark videoId={song.vidURL} />
      </span>
      {/* A pointer's cue that the row plays; on touch the title gets the room */}
      <PlayIcon
        aria-hidden
        className='size-4 shrink-0 fill-current text-muted-foreground transition-colors group-hover:text-foreground touch:hidden'
      />
    </Link>
  </li>
)

// Four rows and part of a fifth, so the cut-off row shows the list scrolls
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
      aria-busy={isLoading}
      className='flex flex-col gap-3 lg:w-100 lg:shrink-0 lg:self-start'>
      <h2
        id='charts-title'
        className='flex min-h-9 items-center px-4 text-xl font-semibold tracking-tight text-foreground md:px-0 touch:min-h-0'>
        YouTube Charts
      </h2>
      <div className='mx-4 rounded-xl bg-card p-2 md:mx-0'>
        <div
          className='no-scrollbar h-(--charts-list-h) overflow-y-auto mask-fade-end'
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
            <ul aria-hidden className='flex flex-col gap-2'>
              {SKELETON_TITLES.map((title) => (
                <li key={title.key} className='flex items-center gap-3 p-2'>
                  <span className='w-5 shrink-0' />
                  <Skeleton
                    shape='thumbnail'
                    className='aspect-video w-24 max-[359px]:w-20'
                  />
                  <span className='flex-1'>{title}</span>
                </li>
              ))}
            </ul>
          )}
          {!isError && !isLoading && (
            <ul className='flex appear flex-col gap-2'>
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
