import { useAtomValue } from 'jotai'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import PlayerRail from '@/components/lyrics-display/player-rail'
import { currentVideoAtom } from '@/context/atoms'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useRecommendations } from '@/lib/listening/recommendations'
import { cn } from '@/utils/cn'

import { LyricsPanel } from './lyrics-panel'
import { MoreLikeThis } from './more-like-this'
import { UP_NEXT_COUNT, UpNext } from './up-next'

const WIDE = '(min-width: 1000px)'

// The song under the video: its title and channel, then the player's own buttons as a row
const SongInfo = ({ compact }: { compact: boolean }) => {
  const video = useAtomValue(currentVideoAtom)
  return (
    <div className='flex min-w-0 flex-col gap-2'>
      <div className='min-w-0'>
        <h1
          className={cn(
            'font-semibold text-pretty text-foreground',
            compact
              ? 'line-clamp-1 text-base'
              : 'line-clamp-2 text-xl leading-snug'
          )}>
          {video?.title ?? ''}
        </h1>
        <p className='truncate text-sm text-muted-foreground'>
          {video?.author ?? ''}
        </p>
      </div>
      <PlayerRail inline />
    </div>
  )
}

type Tab = 'lyrics' | 'next'
const TABS: { id: Tab; label: string }[] = [
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'next', label: 'Up Next' },
]

// A phone or a narrow window: Lyrics and Up Next share the space under the song, one at a time
const NarrowBelow = ({
  videoId,
  version,
}: {
  videoId: string
  version: number | null
}) => {
  const [tab, setTab] = useState<Tab>('lyrics')
  const { songs } = useRecommendations(videoId)
  return (
    <div className='flex min-h-0 flex-1 flex-col gap-3 px-4 pt-3'>
      <SongInfo compact />
      <div
        role='tablist'
        aria-label='Below the Video'
        className='grid shrink-0 grid-cols-2 rounded-full bg-card p-1'>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type='button'
            role='tab'
            id={`watch-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`watch-panel-${id}`}
            onClick={() => {
              setTab(id)
            }}
            className={cn(
              'h-9 rounded-full text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden',
              tab === id
                ? 'bg-primary-subtle text-primary-text'
                : 'text-muted-foreground hover:text-foreground'
            )}>
            {label}
          </button>
        ))}
      </div>
      <div
        role='tabpanel'
        id={`watch-panel-${tab}`}
        aria-labelledby={`watch-tab-${tab}`}
        className='flex min-h-0 flex-1 flex-col pb-(--safe-bottom)'>
        {tab === 'lyrics' ? (
          <LyricsPanel
            videoId={videoId}
            version={version}
            heading={false}
            className='flex-1'
          />
        ) : (
          <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6'>
            <UpNext recommendations={songs} />
            <MoreLikeThis
              songs={songs.slice(UP_NEXT_COUNT)}
              className='mt-6 px-2'
            />
          </div>
        )}
      </div>
    </div>
  )
}

// From 1000px wide: the lyrics beside the video (under it in Theater), the song and More Like This under the
// video, Up Next in the right-hand column
const WideBelow = ({
  videoId,
  version,
  theater,
}: {
  videoId: string
  version: number | null
  theater: boolean
}) => {
  const { songs } = useRecommendations(videoId)
  return (
    <>
      {!theater && (
        <div className='watch-side'>
          <LyricsPanel
            videoId={videoId}
            version={version}
            className='absolute inset-0'
          />
        </div>
      )}
      <div className='flex watch-main flex-col gap-6 pb-8'>
        <SongInfo compact={false} />
        {theater && (
          <LyricsPanel videoId={videoId} version={version} className='h-112' />
        )}
        <MoreLikeThis songs={songs.slice(UP_NEXT_COUNT)} />
      </div>
      <div className='watch-next pb-8'>
        <UpNext recommendations={songs} />
      </div>
    </>
  )
}

// The player page around its stage. `surface` 'stage' is the stage alone, the whole screen, as the player
// always was; 'watch' lays the page out around it. The stage keeps its place in the tree either way, so
// switching never remounts it (and with it the song)
export const WatchPage = ({
  surface,
  theater,
  videoId,
  version,
  stage,
}: {
  surface: 'stage' | 'watch'
  theater: boolean
  videoId: string
  version: number | null
  stage: ReactNode
}) => {
  const wide = useMediaQuery(WIDE)
  const watch = surface === 'watch'
  useEffect(() => {
    document.documentElement.toggleAttribute('data-watch', watch)
    return () => {
      delete document.documentElement.dataset.watch
    }
  }, [watch])
  const below = wide ? (
    <WideBelow videoId={videoId} version={version} theater={theater} />
  ) : (
    <NarrowBelow videoId={videoId} version={version} />
  )

  return (
    <div
      data-theater={watch && wide && theater ? '' : undefined}
      className={watch ? 'watch-page' : 'size-full'}>
      <div className={watch ? 'watch-stage' : 'size-full'}>{stage}</div>
      {watch && below}
    </div>
  )
}
