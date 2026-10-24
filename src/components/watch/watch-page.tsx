import { useAtomValue } from 'jotai'
import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'

import PlayerRail from '@/components/lyrics-display/player-rail'
import { DocScroll } from '@/components/shared/doc-scroll'
import { MinimiseGhost } from '@/components/shared/minimise-ghost'
import { currentVideoAtom } from '@/context/atoms'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useNextList } from '@/lib/listening/recommendations'
import { isInstalledPhone } from '@/lib/pwa'
import { bracketStart } from '@/utils'
import { cn } from '@/utils/cn'

import { LyricsPanel } from './lyrics-panel'
import { PlaylistPanel } from './playlist-panel'
import { Shelves } from './shelves'
import { SongFacts } from './song-facts'
import { SongTitle } from './song-title'
import { UP_NEXT_COUNT, UpNext } from './up-next'
import { useDragToMinimise } from './use-drag-to-minimise'

const WIDE = '(min-width: 1000px)'

// The song under the video: its title and channel, then the player's own buttons as a row. Wide, as on
// YouTube: the title with room above it, then the channel on the left and the buttons on the right. `inset`
// (Theater, the lyrics panel right under it) takes the panel's px-4, so the title starts where its lyrics do
const SongInfo = ({
  compact,
  inset = false,
}: {
  compact: boolean
  inset?: boolean
}) => {
  const video = useAtomValue(currentVideoAtom)
  const videoId = video?.videoId ?? ''
  if (compact) {
    return (
      <div className='flex min-w-0 flex-col gap-2'>
        <div className='min-w-0'>
          <SongTitle
            title={video?.title ?? ''}
            className='text-base leading-snug font-bold'
          />
          <p
            className={cn(
              'truncate text-sm text-muted-foreground',
              bracketStart(video?.author)
            )}>
            {video?.author ?? ''}
          </p>
        </div>
        <PlayerRail inline />
        <SongFacts videoId={videoId} />
      </div>
    )
  }
  return (
    <div className='flex min-w-0 flex-col gap-3 pt-2'>
      {/* Only the words take the inset: the facts card is a card like the lyrics panel, so it keeps the
          panel's edges, and its own padding puts its text on the same line as the title's */}
      <div className={cn('flex min-w-0 flex-col gap-1', inset && 'px-4')}>
        <SongTitle
          title={video?.title ?? ''}
          className='text-xl leading-snug font-bold'
        />
        {/* The buttons on the channel's line, as on YouTube: a long title keeps the full width */}
        <div className='flex flex-wrap items-center justify-between gap-x-6 gap-y-2'>
          <p
            className={cn(
              'min-w-0 truncate text-sm font-medium text-muted-foreground',
              bracketStart(video?.author)
            )}>
            {video?.author ?? ''}
          </p>
          <PlayerRail inline />
        </div>
      </div>
      <SongFacts videoId={videoId} />
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

// A phone or a narrow window: the lyrics straight under the video, where the eye already is, following the song;
// the song, its buttons, Up Next and the rows scroll in their own box under the lyrics
const NarrowBelow = ({
  videoId,
  version,
}: {
  videoId: string
  version: number | null
}) => {
  const more = useMoreLikeThis(videoId)
  // A new song starts at the top of the list under the video, as on YouTube
  const scroller = useRef<HTMLDivElement>(null)
  const scrolledFor = useRef(videoId)
  useEffect(() => {
    if (scrolledFor.current !== videoId) {
      scrolledFor.current = videoId
      scroller.current?.scrollTo({ behavior: 'instant', top: 0 })
    }
  }, [videoId])
  // A phone held upright gets the lyrics as a karaoke window; a narrow window the panel, read from the top
  const upright = useMediaQuery('(pointer: coarse) and (orientation: portrait)')
  return (
    <div className='watch-below flex min-h-0 flex-1 flex-col'>
      <LyricsPanel
        videoId={videoId}
        version={version}
        heading={false}
        band={upright}
        // The line being sung right under the video, with a sliver of the line before it
        followAt={0.08}
        className={cn('mx-4 mt-2 shrink-0', !upright && 'watch-lyrics-under')}
      />
      <div
        ref={scroller}
        data-scroll-top
        className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>
        <div className='flex flex-col gap-4 px-4 pt-4 pb-(--safe-bottom)'>
          <SongInfo compact />
          <div className='pb-6'>
            <PlaylistPanel videoId={videoId} foldable className='mb-4' />
            <UpNext videoId={videoId} autoplaySwitch />
            {/* The rows run to the screen's edges: this box's px-2 plus the page's px-4 */}
            <Shelves
              videoId={videoId}
              similar={more}
              className='mt-6 px-2 [--shelf-bleed:1.5rem]'
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// From 1000px wide: the lyrics beside the video (under it in Theater), the song and its rows (More Like This first)
// under the video, Up Next in the right-hand column
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
        <SongInfo compact={false} inset={theater} />
        {theater && (
          <LyricsPanel videoId={videoId} version={version} className='h-112' />
        )}
        <Shelves videoId={videoId} similar={more} />
      </div>
      <div className='watch-next pb-8'>
        <PlaylistPanel videoId={videoId} foldable={false} className='mb-4' />
        <UpNext videoId={videoId} autoplaySwitch={false} large />
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
  // Wide, the page scrolls as a whole: a new song brings it back to the top, video first, as on YouTube
  const scrolledFor = useRef(videoId)
  useEffect(() => {
    if (scrolledFor.current !== videoId) {
      scrolledFor.current = videoId
      if (watch && wide) {
        window.scrollTo({ behavior: 'instant', top: 0 })
      }
    }
  }, [videoId, watch, wide])
  useEffect(() => {
    document.documentElement.toggleAttribute('data-watch', watch)
    return () => {
      delete document.documentElement.dataset.watch
    }
  }, [watch])
  // The installed app held upright: drag the video down to minimise it
  const stageBox = useRef<HTMLDivElement>(null)
  const minimisable = watch && !wide && isInstalledPhone()
  useDragToMinimise(stageBox, minimisable)
  const below = wide ? (
    <WideBelow videoId={videoId} version={version} theater={theater} />
  ) : (
    <NarrowBelow videoId={videoId} version={version} />
  )

  // Outside the page, which fades as the drag goes on
  return (
    <>
      <div
        data-theater={watch && wide && theater ? '' : undefined}
        className={watch ? 'watch-page' : 'size-full'}>
        <div ref={stageBox} className={watch ? 'watch-stage' : 'size-full'}>
          {stage}
        </div>
        {watch && below}
        {watch && <DocScroll />}
      </div>
      {minimisable && <MinimiseGhost />}
    </>
  )
}
