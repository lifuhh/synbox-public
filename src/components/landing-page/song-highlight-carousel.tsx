import { ChevronLeftIcon, ChevronRightIcon, PlayIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { EditRecommendations } from '@/components/admin/edit-recommendations'
import {
  KaraokeLabelMark,
  KaraokePictureBadgeMark,
} from '@/components/shared/karaoke-badge'
import LoadError from '@/components/shared/load-error'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useLoopingCarousel } from '@/hooks/use-looping-carousel'
import { loopCopies } from '@/lib/carousel-motion'
import { useGetLandingPagePlaylist } from '@/lib/react-query/queries-and-mutations'
import type { formattedYoutubeVideoItemForCarousel } from '@/types'

const SKELETON_CARDS = 5
// Slides on each side of the list's middle copy, more than one flick can travel past
const LOOP_BUFFER = 16

const SongCard = ({
  item,
  active,
  clone,
  eager,
}: {
  item: formattedYoutubeVideoItemForCarousel
  active: boolean
  clone: boolean
  eager: boolean
}) => (
  // A clone stays clickable but out of the tab order and the accessibility tree, so the list is read once
  <Link
    data-bench='carousel-slide'
    to={`/v/${item.videoId}`}
    state={{ videoId: item.videoId }}
    title={item.title}
    aria-hidden={clone || undefined}
    tabIndex={clone ? -1 : undefined}
    data-active={active}
    className='group flex min-w-0 snap-center flex-col rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden motion-safe:transition-transform motion-safe:duration-150 data-[active=false]:motion-safe:scale-94'>
    {/* Off-centre slides shrink, fade their picture and mute their title, so the centred one stands out
        whatever the pictures look like. Text is muted, not faded: faded text would fall below 4.5:1 */}
    <span className='relative aspect-video overflow-hidden rounded-xl bg-thumbnail-placeholder transition-opacity duration-150 group-data-[active=false]:opacity-40'>
      <img
        src={item.thumbnailUrl}
        alt=''
        width='480'
        height='270'
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager && active ? 'high' : 'auto'}
        className='unselectable size-full object-cover transition-transform duration-500 group-hover:scale-104 motion-reduce:transition-none'
      />
      <span className='absolute right-2.5 bottom-2.5 grid size-10 place-items-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100'>
        <PlayIcon className='size-4 fill-current' aria-hidden />
      </span>
      <KaraokePictureBadgeMark videoId={item.videoId} />
    </span>
    {/* Two title lines and the channel's, however long the title, so every card (and the loading one) is
        the same height and the row matches the charts beside it */}
    <span className='mt-4 flex h-19 flex-col gap-1.5'>
      <span className='line-clamp-2 text-base leading-6 font-semibold text-foreground transition-colors duration-150 group-data-[active=false]:text-muted-foreground'>
        {item.title}
      </span>
      <KaraokeLabelMark videoId={item.videoId} />
      <span className='truncate text-sm leading-5 text-muted-foreground'>
        {item.channel}
      </span>
    </span>
  </Link>
)

// A card's exact box: the picture, then the same fixed text block
const CardSkeleton = () => (
  <div className='flex min-w-0 flex-col'>
    <Skeleton shape='card' className='aspect-video w-full' />
    <div className='mt-4 flex h-19 flex-col gap-2.5 pt-1'>
      <Skeleton className='h-4 w-4/5' />
      <Skeleton className='h-3.5 w-1/3' />
    </div>
  </div>
)

// One slide centred with its neighbours peeking in, looping both ways. Touch drags glide on by how hard
// they were flicked; trackpads, Shift+wheel, the arrow keys (once the row has focus) and the buttons move it
// too (useLoopingCarousel)
const SongHighlightCarousel = () => {
  const {
    data: playlistData,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useGetLandingPagePlaylist()
  // State, not a ref: the row only exists once the playlist has loaded, and the hook needs it
  const [track, setTrack] = useState<HTMLDivElement | null>(null)
  const songs = playlistData ?? []
  const count = songs.length
  const copies = loopCopies(count, LOOP_BUFFER)
  const home = ((copies - 1) / 2) * count
  const { active, settled, step } = useLoopingCarousel(track, count, copies)
  const slides = Array.from({ length: count * copies }, (_, index) => ({
    index,
    item: songs[index % count],
  }))

  const loading = isLoading || !playlistData
  const current = settled === null ? undefined : songs[settled]
  const centred = songs.at(active)

  return (
    <section
      aria-label='Recommendations'
      aria-roledescription='carousel'
      className='@container flex min-w-0 flex-1 flex-col gap-3 in-data-rise:rise-in in-data-rise:rise-delay-300'>
      <div className='flex items-center justify-between px-4 md:px-0'>
        <div className='flex items-center gap-1'>
          <h2 className='text-xl font-semibold tracking-tight text-foreground'>
            Recommendations
          </h2>
          <EditRecommendations />
        </div>
        {!isError && (loading || copies > 1) && (
          <div className='flex gap-2 touch:hidden'>
            <Button
              variant='outline'
              size='icon-round'
              aria-label='Previous Recommendation'
              disabled={loading}
              onClick={() => {
                step(-1)
              }}>
              <ChevronLeftIcon className='size-5' />
            </Button>
            <Button
              variant='outline'
              size='icon-round'
              aria-label='Next Recommendation'
              disabled={loading}
              onClick={() => {
                step(1)
              }}>
              <ChevronRightIcon className='size-5' />
            </Button>
          </div>
        )}
      </div>
      {isError && (
        <LoadError
          message="Couldn't load the recommendations."
          retrying={isFetching}
          onRetry={() => {
            void refetch()
          }}
          className='mx-4 aspect-video rounded-xl bg-card md:mx-0 md:aspect-auto md:h-60'
        />
      )}
      {!isError && (
        <div className='carousel-frame'>
          {/* The centred song's picture, blurred, glowing under its card; a new one fades in as the row moves */}
          {centred && (
            <img
              key={centred.videoId}
              // YouTube's 320x180 picture: already soft when stretched to the card, so the glow stays a glow
              // even where the blur isn't drawn
              src={`https://i.ytimg.com/vi/${centred.videoId}/mqdefault.jpg`}
              alt=''
              aria-hidden
              className='carousel-glow appear'
            />
          )}
          {loading ? (
            <output
              aria-label='Loading recommendations'
              data-skeleton
              className='carousel-track'>
              {Array.from({ length: SKELETON_CARDS }, (_, index) => (
                // oxlint-disable-next-line no-array-index-key
                <CardSkeleton key={index} />
              ))}
            </output>
          ) : (
            <div
              ref={setTrack}
              data-bench='carousel'
              // oxlint-disable-next-line no-noninteractive-tabindex -- a scrolling region must be focusable so the arrow keys can scroll it
              tabIndex={0}
              className='carousel-track appear rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
              {slides.map(({ index, item }) => (
                <SongCard
                  // oxlint-disable-next-line no-array-index-key -- each song appears once per copy
                  key={index}
                  item={item}
                  active={index % count === active}
                  clone={index < home || index >= home + count}
                  eager={Math.abs(index - home) < SKELETON_CARDS}
                />
              ))}
            </div>
          )}
        </div>
      )}
      <output className='sr-only'>
        {current && `${current.title}, ${(settled ?? 0) + 1} of ${count}`}
      </output>
    </section>
  )
}

export default SongHighlightCarousel
