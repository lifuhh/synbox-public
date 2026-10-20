import { MicVocalIcon, PlayIcon } from 'lucide-react'
import React, { useRef } from 'react'
import { useNavigate } from 'react-router'

import LoadError from '@/components/shared/load-error'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useOverflow } from '@/hooks/use-overflow'
import {
  useGetChartsPlaylist,
  useSongsWithLyrics,
} from '@/lib/react-query/queries-and-mutations'
import type { CssVars } from '@/types'

// One per visible row (the body is six rows tall); varied so the column doesn't read as a block
const SKELETON_TITLES = [
  <Skeleton key='a' className='h-5 w-5/6' />,
  <Skeleton key='b' className='h-5 w-2/3' />,
  <Skeleton key='c' className='h-5 w-11/12' />,
  <Skeleton key='d' className='h-5 w-3/5' />,
  <Skeleton key='e' className='h-5 w-3/4' />,
  <Skeleton key='f' className='h-5 w-7/12' />,
]

// Same row box as SongRow: p-2 cells around a 24px title line and a 40px icon button
const SongRowSkeleton = ({ title }: { title: React.ReactNode }) => (
  <tr className='bg-card/80'>
    <td className='p-2'>{title}</td>
    <td className='p-2'>
      <Skeleton className='size-10' />
    </td>
  </tr>
)

interface SongRowProps {
  song: {
    title: string
    vidURL: string
  }
  // The song already has karaoke lyrics on the site
  ready: boolean
  onPlayClick: (videoId: string) => () => void
}

const SongRow = ({ song, ready, onPlayClick }: SongRowProps) => {
  const textRef = useRef<HTMLSpanElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const isOverflowing = useOverflow(textRef, containerRef)

  return (
    <tr className='playlist-item bg-card/80 text-accent-foreground hover:bg-muted-foreground/20'>
      <td className='p-2'>
        <div className='flex items-center gap-1.5'>
          {ready && (
            <MicVocalIcon
              className='size-3.5 shrink-0 text-primary'
              aria-label='Lyrics ready'
            />
          )}
          <div
            ref={containerRef}
            className={`min-w-0 flex-1 overflow-hidden ${isOverflowing ? 'marquee' : ''}`}>
            <span
              ref={textRef}
              className='unselectable inline-block whitespace-nowrap'>
              {song.title}
            </span>
          </div>
        </div>
      </td>
      <td className='p-2'>
        <Button
          variant='secondary-link'
          size='icon'
          className='shrink-0'
          aria-label={`Play ${song.title}`}
          onClick={onPlayClick(song.vidURL)}>
          <PlayIcon className='size-6 shrink-0 fill-current' />
        </Button>
      </td>
    </tr>
  )
}

// Six rows, so a list of any length scrolls inside the card
const TABLE_BODY_VARS: CssVars = { '--table-body-h': `${6 * 55}px` }

const LandingPageCharts: React.FC = () => {
  const navigate = useNavigate()
  const {
    data: chartsData,
    isLoading: isChartsDataFetching,
    isError,
    isFetching,
    refetch,
  } = useGetChartsPlaylist()
  const { data: withLyrics } = useSongsWithLyrics(
    chartsData?.map((song) => song.id) ?? []
  )

  const handleRowClick = (videoId: string) => () => {
    void navigate(`/v/${videoId}`)
  }

  return (
    <div
      className='w-full rounded-md border border-primary/30 bg-background lg:mt-2 lg:ml-6 lg:w-5/12 xl:w-4/12'
      aria-busy={isChartsDataFetching}>
      <div className='relative overflow-hidden rounded-md'>
        <table className='w-full table-fixed border-collapse'>
          <colgroup>
            <col className='w-[calc(100%-60px)]' />
            <col className='w-15' />
          </colgroup>
          <thead>
            <tr className='bg-muted text-white'>
              <th className='unselectable py-3 text-center' colSpan={2}>
                YouTube Charts
              </th>
            </tr>
          </thead>
        </table>
        <div
          className='no-scrollbar h-(--table-body-h) overflow-y-auto'
          style={TABLE_BODY_VARS}>
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
          <table
            hidden={isError}
            className='w-full table-fixed border-collapse'>
            <colgroup>
              <col className='w-[calc(100%-60px)]' />
              <col className='w-15' />
            </colgroup>
            <tbody>
              {isChartsDataFetching
                ? SKELETON_TITLES.map((title) => (
                    <SongRowSkeleton key={title.key} title={title} />
                  ))
                : chartsData?.map((song, index) => (
                    <SongRow
                      key={`${song.title}-${index}`}
                      song={{
                        title: song.title,
                        vidURL: song.id,
                      }}
                      ready={withLyrics?.has(song.id) === true}
                      onPlayClick={handleRowClick}
                    />
                  ))}
            </tbody>
            <caption className='mt-1 mb-2 caption-bottom text-sm text-song-channel'>
              Source: YouTube Top 100 Songs Japan ·{' '}
              <MicVocalIcon
                className='inline size-3.5 -translate-y-px text-primary'
                aria-hidden
              />{' '}
              Lyrics ready
            </caption>
          </table>
        </div>
      </div>
    </div>
  )
}

export default LandingPageCharts
