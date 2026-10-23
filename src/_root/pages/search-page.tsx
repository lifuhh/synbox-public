import type { UseQueryResult } from '@tanstack/react-query'
import { ArrowUpRightIcon, SearchIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import { startFromButton } from '@/components/generation/start-generation'
import {
  LibrarySongCard,
  VideoResultCard,
} from '@/components/search/search-result-cards'
import { BoxScrollbar } from '@/components/shared/doc-scroll'
import DotsLoader from '@/components/shared/dots-loader'
import { Button } from '@/components/ui/button'
import { Input, InputField } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useGetSimilarSongs,
  useSearchLibrary,
  useSearchVideos,
} from '@/lib/react-query/queries-and-mutations'
import type {
  LibrarySearchResponse,
  VideoSearchResult,
} from '@/lib/synbox-flask/discovery'
import type { CssVars } from '@/types'
import { extractVideoId } from '@/utils'

const Notice = ({ children }: { children: React.ReactNode }) => (
  <p className='rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground'>
    {children}
  </p>
)

const ResultGrid = ({ children }: { children: React.ReactNode }) => (
  // Each card pads its hover surface, so the grid reaches out by that padding and the pictures line up
  // with the search field
  <div className='-mx-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
    {children}
  </div>
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

const SKELETON_CARDS = [0, 1, 2, 3] as const

// A pasted YouTube link, not a search: the video it names, or null
const linkedVideoId = (query: string) =>
  /youtube\.com|youtu\.be/u.test(query) ? extractVideoId(query) : null

const youtubeSearchUrl = (query: string) =>
  query === ''
    ? 'https://www.youtube.com'
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`

// Search finds only songs we already have lyrics for; anything else is one tap away on YouTube
const LookUpOnYoutube = ({ query }: { query: string }) => (
  <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
    <p className='text-sm text-muted-foreground'>Can’t find your song?</p>
    <Button asChild variant='outline' gap='sm' className='touch:h-11'>
      <a
        href={youtubeSearchUrl(query)}
        target='_blank'
        rel='noopener noreferrer'>
        Look Up on YouTube
        <span className='sr-only'>(opens in a new tab)</span>
        <ArrowUpRightIcon
          aria-hidden
          className='size-4 shrink-0 text-muted-foreground'
        />
      </a>
    </Button>
  </div>
)

// What the library search says besides its songs: none found, an error, or that it is not at its best
const LibraryStatus = ({
  library,
  searching,
  found,
}: {
  library: UseQueryResult<LibrarySearchResponse>
  searching: boolean
  found: number
}) => {
  const notReady = library.data?.ready === false
  if (searching) {
    return null
  }
  if (library.error) {
    return <Notice>{library.error.message}</Notice>
  }
  if (notReady) {
    return (
      <div className='flex flex-wrap items-center gap-3'>
        <Notice>Library still loading. Some songs may be missing.</Notice>
        <Button
          variant='ghost'
          onClick={() => {
            void library.refetch()
          }}>
          Try Again
        </Button>
      </div>
    )
  }
  if (library.data?.mode === 'title_match') {
    return <Notice>Smart search is down. Matching titles only.</Notice>
  }
  return found === 0 ? (
    <p className='text-sm text-muted-foreground'>No results found</p>
  ) : null
}

// Only songs already in Synbox, so every result plays with lyrics: the library's matches, then any the
// YouTube search found that the library search missed (an English title, or the library still loading).
// The one exception is a pasted YouTube link: its video shows even when it is new, and picking it generates it
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
  const linkId = linkedVideoId(query)
  const libraryIds = new Set(library.data?.results.map((s) => s.video_id))
  const extra = (videos.data?.results ?? []).filter(
    (r) => (r.processed || r.video_id === linkId) && !libraryIds.has(r.video_id)
  )
  const libraryResults = library.data?.results ?? []
  // A retry after the library gave up has data already, so isLoading stays false while it waits again
  const notReady = library.data?.ready === false
  const searching =
    library.isLoading ||
    (notReady && library.isFetching) ||
    (libraryResults.length === 0 && extra.length === 0 && videos.isLoading)
  const [inner, height] = useContentHeight()
  const heightVars: CssVars | undefined =
    height === null ? undefined : { '--smooth-h': `${height}px` }
  return (
    <div style={heightVars} className='smooth-height'>
      <div ref={inner} className='flex flex-col gap-6'>
        <div className='flex flex-col gap-3'>
          <LibraryStatus
            library={library}
            searching={searching}
            found={libraryResults.length + extra.length}
          />
          <ResultGrid>
            {libraryResults.map((song) => (
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
        </div>
        <LookUpOnYoutube query={query} />
      </div>
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

// Two queries a tap away, which show that a mood or a description works too
const EXAMPLES = ['Calm songs about the night', 'Ado songs that feel angry']

const Examples = ({ onSearch }: { onSearch: (query: string) => void }) => (
  <ul aria-label='Examples' className='flex flex-wrap gap-2'>
    {EXAMPLES.map((example) => (
      <li key={example}>
        <Button
          variant='outline'
          size='pill'
          className='touch:h-11'
          onClick={() => {
            onSearch(example)
          }}>
          {example}
        </Button>
      </li>
    ))}
  </ul>
)

const SearchBody = ({
  query,
  similarTo,
  onSearch,
  onBack,
  onSelect,
  onMoreLikeThis,
}: {
  query: string
  similarTo: string
  onSearch: (query: string) => void
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
    return <Examples onSearch={onSearch} />
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
  const [box, setBox] = useState<HTMLElement | null>(null)
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
      ref={setBox}
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
            placeholder='Song, artist or mood'
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
          onSearch={(q) => {
            setParams({ q })
          }}
          onBack={() => {
            setParams({ q: query })
          }}
          onSelect={handleSelect}
          onMoreLikeThis={handleMoreLikeThis}
        />
      </div>
      <BoxScrollbar box={box} />
    </section>
  )
}

export default SearchPage
