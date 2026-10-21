import { MicVocalIcon, PlayIcon } from 'lucide-react'
import type React from 'react'
import { Link } from 'react-router'

import { KaraokeMark } from '@/components/shared/karaoke-badge'
import LoadError from '@/components/shared/load-error'
import { Skeleton } from '@/components/ui/skeleton'
import { useGetChartsPlaylist } from '@/lib/react-query/queries-and-mutations'
import type { CssVars } from '@/types'

// One per visible row (the list is about six rows tall); varied so the column doesn't read as a block
const SKELETON_TITLES = [
  <Skeleton key='a' className='h-4 w-5/6' />,
  <Skeleton key='b' className='h-4 w-2/3' />,
  <Skeleton key='c' className='h-4 w-11/12' />,
  <Skeleton key='d' className='h-4 w-3/5' />,
  <Skeleton key='e' className='h-4 w-3/4' />,
  <Skeleton key='f' className='h-4 w-7/12' />,
]

interface SongRowProps {
  song: {
    title: string
    vidURL: string
  }
}

// The whole row opens the song; the title wraps to two lines rather than scrolling on hover
const SongRow = ({ song }: SongRowProps) => (
  <li>
    <Link
      to={`/v/${song.vidURL}`}
      className='group flex min-h-12 items-center gap-2 rounded-lg px-2 py-1.5 text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
      <KaraokeMark videoId={song.vidURL} />
      <span className='line-clamp-2 min-w-0 flex-1 text-sm text-pretty'>
        {song.title}
      </span>
      <PlayIcon
        aria-hidden
        className='size-4 shrink-0 fill-current text-muted-foreground transition-colors group-hover:text-foreground'
      />
    </Link>
  </li>
)

// About six rows, so a list of any length scrolls inside the card
const LIST_VARS: CssVars = { '--charts-list-h': `${6 * 56}px` }

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
          className='no-scrollbar h-(--charts-list-h) overflow-y-auto'
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
            <ul aria-hidden>
              {SKELETON_TITLES.map((title) => (
                <li key={title.key} className='flex min-h-12 items-center px-2'>
                  {title}
                </li>
              ))}
            </ul>
          )}
          {!isError && !isLoading && (
            <ul className='appear'>
              {chartsData?.map((song, index) => (
                <SongRow
                  key={`${song.title}-${index}`}
                  song={{ title: song.title, vidURL: song.id }}
                />
              ))}
            </ul>
          )}
        </div>
        <p className='mx-2 mt-1 mb-1 truncate text-sm text-song-channel'>
          YouTube Top 100 Japan ·{' '}
          <MicVocalIcon
            className='inline size-3.5 -translate-y-px text-primary-text'
            aria-hidden
          />{' '}
          Karaoke
        </p>
      </div>
    </section>
  )
}

export default LandingPageCharts
