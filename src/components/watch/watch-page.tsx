import { useAtomValue } from 'jotai'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import PlayerRail from '@/components/lyrics-display/player-rail'
import { currentVideoAtom } from '@/context/atoms'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useNextList } from '@/lib/listening/recommendations'
import { cn } from '@/utils/cn'

import { LyricsPanel } from './lyrics-panel'
import { MoreLikeThis } from './more-like-this'
import { Shelves } from './shelves'
import { UP_NEXT_COUNT, UpNext } from './up-next'

const WIDE = '(min-width: 1000px)'

// The song under the video: its title and channel, then the player's own buttons as a row. Wide, as on
// YouTube: the title with room above it, then the channel on the left and the buttons on the right
const SongInfo = ({ compact }: { compact: boolean }) => {
  const video = useAtomValue(currentVideoAtom)
  if (compact) {
    return (
      <div className='flex min-w-0 flex-col gap-2'>
        <div className='min-w-0'>
          <h1 className='line-clamp-2 text-base leading-snug font-semibold text-pretty text-foreground'>
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
  return (
    <div className='flex min-w-0 flex-col gap-3 pt-2'>
      <h1 className='line-clamp-2 text-xl leading-snug font-semibold text-pretty text-foreground'>
        {video?.title ?? ''}
      </h1>
      <div className='flex flex-wrap items-center justify-between gap-x-6 gap-y-2'>
        <p className='min-w-0 truncate text-base font-medium text-foreground'>
          {video?.author ?? ''}
        </p>
        <PlayerRail inline />
      </div>
    </div>
  )
}

// The songs the list beside the video doesn't show, as it is filtered now
const useMoreLikeThis = (videoId: string) => {
  const { all, songs } = useNextList(videoId)
  const listed = new Set(
    songs.slice(0, UP_NEXT_COUNT).map((song) => song.videoId)
  )
  return all.filter((song) => !listed.has(song.videoId))
}

type Tab = 'lyrics' | 'next'
const TABS: { id: Tab; label: string }[] = [
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'next', label: 'Up Next' },
]

// A phone or a narrow window: everything under the video scrolls as one page, as on YouTube, so a swipe
// anywhere below the video moves it; the tabs stick under the video once the song's title has scrolled away.
// Up Next is part of that page. The lyrics keep their own box (they follow the song), one screen tall, so
// with the tabs stuck they fill what is left under the video
const NarrowBelow = ({
  videoId,
  version,
}: {
  videoId: string
  version: number | null
}) => {
  const [tab, setTab] = useState<Tab>('lyrics')
  const more = useMoreLikeThis(videoId)
  return (
    <div className='watch-below min-h-0 flex-1 overflow-y-auto overscroll-contain'>
      <div className='flex flex-col gap-3 px-4 pt-3 pb-(--safe-bottom)'>
        <SongInfo compact />
        <div className='sticky top-0 z-10 -mx-4 bg-background px-4 py-2'>
          <div
            role='tablist'
            aria-label='Below the Video'
            className='grid grid-cols-2 rounded-full bg-card p-1'>
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type='button'
                role='tab'
                id={`watch-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={tab === id ? `watch-panel-${id}` : undefined}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => {
                  setTab(id)
                }}
                // Left and Right move between the tabs, as in any tab list
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                    return
                  }
                  event.preventDefault()
                  const next = id === 'lyrics' ? 'next' : 'lyrics'
                  setTab(next)
                  document
                    .querySelector<HTMLElement>(`#watch-tab-${next}`)
                    ?.focus()
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
        </div>
        <div
          role='tabpanel'
          id={`watch-panel-${tab}`}
          aria-labelledby={`watch-tab-${tab}`}>
          {tab === 'lyrics' ? (
            <LyricsPanel
              videoId={videoId}
              version={version}
              heading={false}
              className='watch-lyrics-tab'
            />
          ) : (
            <div className='pb-6'>
              <UpNext videoId={videoId} autoplaySwitch />
              <MoreLikeThis songs={more} className='mt-6 px-2' />
              <Shelves videoId={videoId} className='mt-6 px-2' />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// From 1000px wide: the lyrics beside the video (under it in Theater), the song, More Like This and its rows under the
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
  const more = useMoreLikeThis(videoId)
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
        <MoreLikeThis songs={more} />
        <Shelves videoId={videoId} />
      </div>
      <div className='watch-next pb-8'>
        <UpNext videoId={videoId} autoplaySwitch={false} />
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
