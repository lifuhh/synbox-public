import { PlayIcon } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useOverflow } from '@/hooks/useOverflow'
import { useGetChartsPlaylist } from '@/lib/react-query/queriesAndMutations'

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

const LandingPageCharts: React.FC = () => {
  const navigate = useNavigate()
  const { data: chartsData, isLoading: isChartsDataFetching } =
    useGetChartsPlaylist()

  const handleRowClick = (videoId: string) => () => {
    navigate(`/v/${videoId}`)
  }

  const tableBodyHeight = 6 * 55

  return (
    <div
      className='w-full rounded-md border border-primary/30 bg-background lg:mt-2 lg:ml-6 lg:w-5/12 xl:w-4/12'
      aria-busy={isChartsDataFetching}>
      <div className='relative overflow-hidden rounded-md'>
        <table
          className='w-full border-collapse'
          style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 'calc(100% - 60px)' }} />
            <col style={{ width: '60px' }} />
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
          className='no-scrollbar overflow-y-auto'
          style={{ height: `${tableBodyHeight}px` }}>
          <table
            className='w-full border-collapse'
            style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 'calc(100% - 60px)' }} />
              <col style={{ width: '60px' }} />
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
                      onPlayClick={handleRowClick}
                    />
                  ))}
            </tbody>
            <caption className='mt-1 mb-2 caption-bottom text-sm text-gray-300'>
              Source: Top 100 Japan YouTube
            </caption>
          </table>
        </div>
      </div>
    </div>
  )
}

interface SongRowProps {
  song: {
    title: string
    vidURL: string
  }
  onPlayClick: (videoId: string) => () => void
}

const SongRow = ({ song, onPlayClick }: SongRowProps) => {
  const [isOverflowing, setIsOverflowing] = useState(false)
  const textRef = useRef<HTMLSpanElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useOverflow(textRef, containerRef, 'marquee')

  useEffect(() => {
    const checkOverflow = () => {
      if (textRef.current && containerRef.current) {
        setIsOverflowing(
          textRef.current.scrollWidth > containerRef.current.clientWidth
        )
      }
    }

    checkOverflow()
    window.addEventListener('resize', checkOverflow)

    return () => {
      window.removeEventListener('resize', checkOverflow)
    }
  }, [song.title])

  return (
    <tr className='playlist-item bg-card/80 text-accent-foreground hover:bg-muted-foreground/20'>
      <td className='p-2'>
        <div
          ref={containerRef}
          className={`overflow-hidden ${isOverflowing ? 'marquee' : ''}`}>
          <span
            ref={textRef}
            className={`unselectable inline-block whitespace-nowrap ${
              isOverflowing ? 'marquee-content' : ''
            }`}>
            {song.title}
          </span>
        </div>
      </td>
      <td className='p-2'>
        <Button
          variant='link'
          size='icon'
          className='shrink-0 bg-secondary'
          onClick={onPlayClick(song.vidURL)}>
          <PlayIcon className='size-6 shrink-0 fill-current' />
        </Button>
      </td>
    </tr>
  )
}

export default LandingPageCharts
