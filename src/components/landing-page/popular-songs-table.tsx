import { MicVocalIcon, PlayIcon } from 'lucide-react'
import type React from 'react'
import { Link } from 'react-router'

import { ListenCount } from '@/components/shared/listen-count'
import LoadError from '@/components/shared/load-error'
import { MarqueeText } from '@/components/shared/marquee-text'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useGetChartsPlaylist,
  useHasKaraoke,
} from '@/lib/react-query/queries-and-mutations'
import { compactCount } from '@/lib/song-stats'
import type { ChartSong, CssVars } from '@/types'

// A row: a 72×41 thumbnail (16:9), then the title on one 20px line over the rank, YouTube views and Synbox listens on one 16px
// line.
// 12 px apart inside a row; rows are 4 px padded top and bottom and 2 px apart, so six fit beside the
// recommendations. The play cue ends 16px from the edge. The list starts 2 px down so the first row's karaoke mic,
// floating over its thumbnail's corner, isn't cut off
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

// Only this list mixes songs with karaoke and songs without (a chart song outside the library plays with Generate
// Lyrics), so only it marks the karaoke ones: the bare mic tucked into the thumbnail's bottom-left corner, with a dark
// halo so it reads on any picture; a tighter, lighter one on a phone, where the halo would swamp so small a mark. The
// glyph's box is a tenth of its size emptier on the left than at the bottom, so the left offset is smaller and the
// drawn mic sits the same distance from both edges. A screen reader hears it after the title
const KaraokeMark = ({ videoId }: { videoId: string }) =>
  useHasKaraoke(videoId) ? (
    <MicVocalIcon
      aria-hidden
      data-karaoke-badge
      strokeWidth={2.5}
      className='pointer-events-none absolute bottom-1 left-0.5 size-4 text-primary-text drop-shadow-sm drop-shadow-black/90 touch:drop-shadow-xs touch:drop-shadow-black/60'
    />
  ) : null

// Never inside the scrolling title: WebKit counts its hidden text and clips a title that fits with an ellipsis
const KaraokeLabel = ({ videoId }: { videoId: string }) =>
  useHasKaraoke(videoId) ? (
    <span className='sr-only'>, Karaoke Lyrics</span>
  ) : null

// The whole row opens the song, so the rank and counts are plain text, not chips that look pressable (listens as on
// the song cards). The picture
// leads, as many titles are in Japanese; the title takes one line, scrolling on hover when cut, and the song's
// page shows it whole
const SongRow = ({ song }: { song: ChartSong }) => (
  <li>
    <Link
      data-bench='charts-row'
      data-marquee-host
      to={`/v/${song.id}`}
      className='group flex items-center gap-3 rounded-xl px-2 py-1 text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
      <span className='relative aspect-video w-18 shrink-0 rounded-sm bg-thumbnail-placeholder'>
        <img
          src={`https://i.ytimg.com/vi/${song.id}/mqdefault.jpg`}
          alt=''
          width='320'
          height='180'
          loading='lazy'
          decoding='async'
          className='size-full rounded-sm object-cover'
        />
        <KaraokeMark videoId={song.id} />
      </span>
      <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <MarqueeText className='text-sm leading-5'>{song.title}</MarqueeText>
        <span className='flex items-center gap-2.5 text-xs leading-4 text-muted-foreground tabular-nums'>
          <span className='font-semibold text-foreground'>
            <span className='sr-only'>Rank </span>#{song.rank}
          </span>
          {song.views !== undefined && (
            <span>{compactCount(song.views)} views</span>
          )}
          <ListenCount videoId={song.id} />
        </span>
      </span>
      <KaraokeLabel videoId={song.id} />
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
        YouTube Top 100 Japan
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
                  <Skeleton shape='thumbnail' className='aspect-video w-18' />
                  <span className='flex flex-1 flex-col gap-1.5'>
                    {title}
                    <Skeleton className='h-3 w-1/3' />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!isError && !isLoading && (
            <ul className='flex appear flex-col gap-0.5 pt-0.5 pb-8'>
              {chartsData?.map((song) => (
                <SongRow key={song.rank} song={song} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

export default LandingPageCharts
