import { MicIcon, PlayIcon } from 'lucide-react'
import type React from 'react'
import { Link } from 'react-router'

import LoadError from '@/components/shared/load-error'
import { MarqueeText } from '@/components/shared/marquee-text'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useGetChartsPlaylist,
  useKaraokeIds,
} from '@/lib/react-query/queries-and-mutations'
import { compactCount, useListensOf } from '@/lib/song-stats'
import type { ChartSong, CssVars } from '@/types'

// A row: a 72×41 thumbnail (16:9), then the title on one 20px line over the rank, YouTube views and Synbox listens on one 16px
// line.
// 12 px apart inside a row; rows are 4 px padded top and bottom and 2 px apart, so six fit beside the
// recommendations. The play cue ends 16px from the edge
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
// Lyrics), so only it marks the karaoke ones: a mic at the end of the meta line, drawn like the text beside it (its
// size and a stroke as light as the text's weight), with Synbox's own listens after it, since only karaoke songs
// have them. Last on the line, so a count that arrives later only lengthens it: the rank and views never move. The
// mic is upright (a diagonal one's handle pulls its weight down and left) and as tall in ink as the text's figures,
// centred on them, not a size larger. Under 12.5rem (a
// 320px phone) the line can't hold "#100 · 142M views · 2.1K listens", so the word goes, for the eye only
const KaraokeMeta = ({ listens }: { listens: number | undefined }) => (
  <span className='inline-flex min-w-0 items-center gap-1 text-primary-text'>
    <MicIcon
      aria-hidden
      data-karaoke-badge
      strokeWidth={2}
      className='size-[11px] shrink-0'
    />
    <span className='sr-only'>Karaoke</span>
    {listens !== undefined && listens > 0 && (
      <span className='appear truncate text-muted-foreground'>
        <span className='sr-only'>, </span>
        {compactCount(listens)}
        <span className='@max-[12.5rem]:sr-only'>
          {listens === 1 ? ' listen' : ' listens'}
        </span>
      </span>
    )}
  </span>
)

// The whole row opens the song, so the rank and counts are plain text, not chips that look pressable. The picture
// leads, as many titles are in Japanese; the title takes one line, scrolling on hover when cut, and the song's
// page shows it whole
const SongRow = ({
  song,
  karaoke,
  listens,
}: {
  song: ChartSong
  karaoke: boolean
  listens: number | undefined
}) => (
  <li>
    <Link
      data-bench='charts-row'
      data-marquee-host
      to={`/v/${song.id}`}
      className='group flex items-center gap-3 rounded-xl px-2 py-1 text-foreground transition-colors hover:bg-accent'>
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
      </span>
      <span className='@container flex min-w-0 flex-1 flex-col gap-0.5'>
        <MarqueeText className='text-sm leading-5'>{song.title}</MarqueeText>
        <span className='flex min-w-0 items-center gap-2.5 text-xs leading-4 whitespace-nowrap text-muted-foreground tabular-nums'>
          <span className='shrink-0 font-semibold text-foreground'>
            <span className='sr-only'>Rank </span>#{song.rank}
          </span>
          {song.views !== undefined && (
            <span className='shrink-0'>{compactCount(song.views)} views</span>
          )}
          {karaoke && <KaraokeMeta listens={listens} />}
        </span>
      </span>
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
  const { data: karaokeIds } = useKaraokeIds()
  const karaokeSongs =
    chartsData
      ?.filter((song) => karaokeIds?.has(song.id) === true)
      .map((song) => song.id) ?? []
  // One request for every karaoke song on the chart
  const { data: listens } = useListensOf(karaokeSongs)

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
                <SongRow
                  key={song.rank}
                  song={song}
                  karaoke={karaokeIds?.has(song.id) === true}
                  listens={listens?.[song.id]}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

export default LandingPageCharts
