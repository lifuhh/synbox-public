import { useAtomValue } from 'jotai'
import type { ReactNode } from 'react'
import { useEffect } from 'react'

import PlayerRail from '@/components/lyrics-display/player-rail'
import { currentVideoAtom } from '@/context/atoms'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useNextList } from '@/lib/listening/recommendations'

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
  return (
    <div className='watch-below flex min-h-0 flex-1 flex-col'>
      <LyricsPanel
        videoId={videoId}
        version={version}
        heading={false}
        className='mx-4 mt-3 watch-lyrics-under shrink-0'
      />
      <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>
        <div className='flex flex-col gap-4 px-4 pt-4 pb-(--safe-bottom)'>
          <SongInfo compact />
          <div className='pb-6'>
            <UpNext videoId={videoId} autoplaySwitch />
            <MoreLikeThis songs={more} className='mt-6 px-2' />
            <Shelves videoId={videoId} className='mt-6 px-2' />
          </div>
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
