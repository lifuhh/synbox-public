import type { UseQueryResult } from '@tanstack/react-query'
import { SearchIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import { startFromButton } from '@/components/generation/start-generation'
import {
  LibrarySongCard,
  VideoResultCard,
} from '@/components/search/search-result-cards'
import DotsLoader from '@/components/shared/dots-loader'
import { GoogleMark } from '@/components/shared/google-mark'
import { Button } from '@/components/ui/button'
import { Input, InputField } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { noSongReason, signInWithGoogle, useAccess } from '@/lib/auth'
import {
  useGetSimilarSongs,
  useSearchLibrary,
  useSearchVideos,
} from '@/lib/react-query/queries-and-mutations'
import type {
  LibrarySearchResponse,
  VideoSearchResponse,
  VideoSearchResult,
} from '@/lib/synbox-flask/discovery'
import type { CssVars } from '@/types'

const Notice = ({ children }: { children: React.ReactNode }) => (
  <p className='rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground'>
    {children}
  </p>
)

const ResultGrid = ({ children }: { children: React.ReactNode }) => (
  // Each card pads its hover surface, so the grid reaches out by that padding and the pictures line up
  // with the heading and the search field
  <div className='-mx-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
    {children}
  </div>
)

// A quieter hint can follow the heading on its line, as the Lyrics Style panel's do
const Section = ({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) => (
  <div className='flex flex-col gap-3'>
    <div className='flex min-w-0 flex-wrap items-baseline gap-x-2'>
      <h2 className='text-lg font-semibold text-foreground'>{title}</h2>
      {hint !== undefined && (
        <p className='text-sm text-muted-foreground'>{hint}</p>
      )}
    </div>
    {children}
  </div>
)

const NoResults = () => (
  <p className='text-sm text-muted-foreground'>No results found</p>
)

// The height of a box's content, followed as it changes: the box under it (smooth-height in globals.css) eases
// to it, so what sits under the box glides instead of jumping when the content grows or shrinks (placeholders
// giving way to results, or to none)
const useContentHeight = () => {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const element = inner.current
    const observer = new ResizeObserver(() => {
      if (element !== null) {
        setHeight(element.offsetHeight)
      }
    })
    if (element !== null) {
      observer.observe(element)
    }
    return () => {
      observer.disconnect()
    }
  }, [])
  return [inner, height] as const
}

type LibraryQuery = UseQueryResult<LibrarySearchResponse>

const SKELETON_CARDS = [0, 1, 2, 3] as const
type VideosQuery = UseQueryResult<VideoSearchResponse>

const ReadyToSing = ({
  library,
  extra,
  onSelect,
  onMoreLikeThis,
}: {
  library: LibraryQuery
  extra: VideoSearchResult[]
  onSelect: (result: VideoSearchResult) => void
  onMoreLikeThis: (videoId: string) => void
}) => {
  // A retry after the library gave up has data already, so isLoading stays false while it waits again
  const notReady = library.data?.ready === false
  const searching = library.isLoading || (notReady && library.isFetching)
  const empty =
    !searching &&
    library.error === null &&
    !notReady &&
    (library.data?.results.length ?? 0) + extra.length === 0
  const [inner, height] = useContentHeight()
  const heightVars: CssVars | undefined =
    height === null ? undefined : { '--smooth-h': `${height}px` }
  return (
    <div style={heightVars} className='smooth-height'>
      <div ref={inner}>
        <Section title='Ready To Sing'>
          {empty && <NoResults />}
          {searching && (
            <div className='flex items-center gap-3 text-sm text-muted-foreground'>
              <DotsLoader size='sm' />
              Searching your library
            </div>
          )}
          {library.error && <Notice>{library.error.message}</Notice>}
          {notReady && !searching && (
            <div className='flex flex-wrap items-center gap-3'>
              <Notice>
                Your library is taking longer than usual to load, so songs
                already in Synbox may be missing.
              </Notice>
              <Button
                variant='ghost'
                onClick={() => {
                  void library.refetch()
                }}>
                Try Again
              </Button>
            </div>
          )}
          {library.data?.mode === 'title_match' && (
            <Notice>
              Smart search is unavailable, so these match titles and artists
              only.
            </Notice>
          )}
          <ResultGrid>
            {library.data?.results.map((song) => (
              <LibrarySongCard
                key={song.video_id}
                song={song}
                onMoreLikeThis={onMoreLikeThis}
              />
            ))}
            {extra.map((result) => (
              <VideoResultCard
                key={result.video_id}
                result={result}
                onSelect={onSelect}
              />
            ))}
            {searching &&
              SKELETON_CARDS.map((i) => (
                <div key={i} className='flex flex-col gap-2 p-2'>
                  <Skeleton shape='thumbnail' className='aspect-video w-full' />
                  <Skeleton className='h-4 w-3/4' />
                  <Skeleton className='h-3 w-1/2' />
                </div>
              ))}
          </ResultGrid>
        </Section>
      </div>
    </div>
  )
}

// Adding a song from YouTube generates it. When that would be refused, the cards go and the reason stays,
// with sign-in for a guest
const NoNewSongs = () => {
  const access = useAccess()
  return (
    <Section title='From YouTube'>
      <div className='flex flex-wrap items-center gap-3'>
        <Notice>
          {access.kind === 'user'
            ? noSongReason(access.quota)
            : "You've used today's free song. Sign in to add more songs from YouTube."}
        </Notice>
        {access.kind === 'guest' && (
          <Button
            gap='md'
            onClick={() => {
              void signInWithGoogle()
            }}>
            <GoogleMark />
            Sign In
          </Button>
        )}
      </div>
    </Section>
  )
}

const FromYoutube = ({
  videos,
  results,
  onSelect,
}: {
  videos: VideosQuery
  results: VideoSearchResult[]
  onSelect: (result: VideoSearchResult) => void
}) => (
  <Section title='From YouTube' hint='Pick a song to generate its lyrics'>
    {videos.isLoading && <DotsLoader />}
    {!videos.isLoading && videos.error === null && results.length === 0 && (
      <NoResults />
    )}
    {videos.error && <Notice>{videos.error.message}</Notice>}
    {videos.data?.source === 'youtube' && !videos.data.filtered && (
      <Notice>
        Smart filtering is unavailable, so some of these may not be singable.
      </Notice>
    )}
    <ResultGrid>
      {results.map((result) => (
        <VideoResultCard
          key={result.video_id}
          result={result}
          onSelect={onSelect}
        />
      ))}
    </ResultGrid>
  </Section>
)

// One list for both searches: songs already in Synbox first, then YouTube videos that can be added.
const SearchResults = ({
  query,
  onSelect,
  onMoreLikeThis,
}: {
  query: string
  onSelect: (result: VideoSearchResult) => void
  onMoreLikeThis: (videoId: string) => void
}) => {
  const library = useSearchLibrary(query)
  const videos = useSearchVideos(query)
  const { newSong } = useAccess()
  const libraryIds = new Set(library.data?.results.map((s) => s.video_id))
  const youtube = videos.data?.results ?? []
  // The library search can miss a processed song YouTube found (a description, or the library still loading).
  const readyVideos = youtube.filter(
    (r) => r.processed && !libraryIds.has(r.video_id)
  )
  const newVideos = youtube.filter((r) => !r.processed)
  // Both sections always show, each saying when it found nothing, so neither appears or goes and moves the other
  return (
    <div className='flex flex-col gap-6'>
      <ReadyToSing
        library={library}
        extra={readyVideos}
        onSelect={onSelect}
        onMoreLikeThis={onMoreLikeThis}
      />
      {newSong ? (
        <FromYoutube videos={videos} results={newVideos} onSelect={onSelect} />
      ) : (
        <NoNewSongs />
      )}
      {videos.data?.source === 'library_only' && (
        <Notice>
          YouTube search is unavailable right now, so only songs already in
          Synbox are shown.
        </Notice>
      )}
    </div>
  )
}

const SimilarSongs = ({
  videoId,
  onBack,
  onMoreLikeThis,
}: {
  videoId: string
  onBack: () => void
  onMoreLikeThis: (videoId: string) => void
}) => {
  const { data, error, isLoading } = useGetSimilarSongs(videoId)
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between gap-4'>
        <h2 className='min-w-0 truncate text-lg font-semibold text-foreground'>
          More Like {data?.song?.title ?? 'This'}
        </h2>
        <Button variant='ghost' onClick={onBack}>
          Back To Results
        </Button>
      </div>
      {isLoading && <DotsLoader />}
      {error && <Notice>{error.message}</Notice>}
      {data?.results.length === 0 && <Notice>No similar songs yet.</Notice>}
      <ResultGrid>
        {data?.results.map((song) => (
          <LibrarySongCard
            key={song.video_id}
            song={song}
            onMoreLikeThis={onMoreLikeThis}
          />
        ))}
      </ResultGrid>
    </div>
  )
}

const SearchBody = ({
  query,
  similarTo,
  onBack,
  onSelect,
  onMoreLikeThis,
}: {
  query: string
  similarTo: string
  onBack: () => void
  onSelect: (result: VideoSearchResult) => void
  onMoreLikeThis: (videoId: string) => void
}) => {
  if (similarTo !== '') {
    return (
      <SimilarSongs
        videoId={similarTo}
        onBack={onBack}
        onMoreLikeThis={onMoreLikeThis}
      />
    )
  }
  if (query === '') {
    return (
      <Notice>
        Search for a song or artist, or describe what you want to sing, like
        “calm songs about the night” or “Ado songs that feel angry”.
      </Notice>
    )
  }
  return (
    <SearchResults
      query={query}
      onSelect={onSelect}
      onMoreLikeThis={onMoreLikeThis}
    />
  )
}

const SearchPage = () => {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const query = (params.get('q') ?? '').trim()
  const similarTo = params.get('similar') ?? ''

  const handlePlay = (videoId: string) => {
    void navigate(`/v/${videoId}`, { state: { videoId } })
  }

  const handleSelect = (result: VideoSearchResult) => {
    if (result.processed) {
      handlePlay(result.video_id)
    } else {
      void startFromButton({
        mode: 'new',
        title: result.title,
        videoId: result.video_id,
      })
    }
  }

  const handleMoreLikeThis = (videoId: string) => {
    setParams({ q: query, similar: videoId })
  }

  return (
    <section
      data-scroll-top
      className='flex custom-scrollbar flex-1 flex-col gap-4 overflow-y-scroll pt-page-top page-x pb-page-bottom'>
      <title>Search · Synbox</title>
      <form
        key={query}
        className='w-full sm:mx-auto sm:w-4/5'
        onSubmit={(e) => {
          e.preventDefault()
          const value = new FormData(e.currentTarget).get('q')
          const q = typeof value === 'string' ? value.trim() : ''
          if (q !== '') {
            setParams({ q })
          }
        }}>
        {/* The home page's field: a pill with its action inside, an icon on phones and a labelled one wider */}
        <InputField>
          <Input
            name='q'
            defaultValue={query}
            aria-label='Search Songs'
            enterKeyHint='search'
            placeholder='Search a song, or describe one: “sad songs by a female singer”'
            variant='bare'
          />
          <Button
            type='submit'
            variant='hero'
            size='icon'
            aria-label='Search'
            className='shrink-0 sm:hidden'>
            <SearchIcon className='size-5' />
          </Button>
          <Button
            type='submit'
            variant='hero'
            size='inset'
            gap='sm'
            className='hidden shrink-0 sm:inline-flex'>
            <SearchIcon className='size-5' aria-hidden />
            <span className='text-label'>Search</span>
          </Button>
        </InputField>
      </form>

      <div className='sm:mx-auto sm:w-4/5'>
        <SearchBody
          query={query}
          similarTo={similarTo}
          onBack={() => {
            setParams({ q: query })
          }}
          onSelect={handleSelect}
          onMoreLikeThis={handleMoreLikeThis}
        />
      </div>
    </section>
  )
}

export default SearchPage
