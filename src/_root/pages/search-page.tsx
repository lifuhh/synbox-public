import type { UseQueryResult } from '@tanstack/react-query'
import { SearchIcon } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router'

import {
  LibrarySongCard,
  VideoResultCard,
} from '@/components/search/search-result-cards'
import DotsLoader from '@/components/shared/dots-loader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { startGeneration } from '@/lib/generation/store'
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

const Notice = ({ children }: { children: React.ReactNode }) => (
  <p className='rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground'>
    {children}
  </p>
)

const ResultGrid = ({ children }: { children: React.ReactNode }) => (
  <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
    {children}
  </div>
)

const Section = ({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) => (
  <div className='flex flex-col gap-3'>
    <h2 className='text-lg font-semibold text-foreground'>{title}</h2>
    {children}
  </div>
)

type LibraryQuery = UseQueryResult<LibrarySearchResponse>
type VideosQuery = UseQueryResult<VideoSearchResponse>

const ReadyToSing = ({
  library,
  extra,
  onPlay,
  onSelect,
  onMoreLikeThis,
}: {
  library: LibraryQuery
  extra: VideoSearchResult[]
  onPlay: (videoId: string) => void
  onSelect: (result: VideoSearchResult) => void
  onMoreLikeThis: (videoId: string) => void
}) => (
  <Section title='Ready To Sing'>
    {library.isLoading && <DotsLoader />}
    {library.error && <Notice>{library.error.message}</Notice>}
    {library.data?.mode === 'title_match' && (
      <Notice>
        Smart search is unavailable, so these match titles and artists only.
      </Notice>
    )}
    <ResultGrid>
      {library.data?.results.map((song) => (
        <LibrarySongCard
          key={song.video_id}
          song={song}
          onPlay={onPlay}
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
    </ResultGrid>
  </Section>
)

const AddFromYoutube = ({
  videos,
  results,
  onSelect,
}: {
  videos: VideosQuery
  results: VideoSearchResult[]
  onSelect: (result: VideoSearchResult) => void
}) => (
  <Section title='Add From YouTube'>
    {videos.isLoading && <DotsLoader />}
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
  onPlay,
  onSelect,
  onMoreLikeThis,
}: {
  query: string
  onPlay: (videoId: string) => void
  onSelect: (result: VideoSearchResult) => void
  onMoreLikeThis: (videoId: string) => void
}) => {
  const library = useSearchLibrary(query)
  const videos = useSearchVideos(query)
  const libraryIds = new Set(library.data?.results.map((s) => s.video_id))
  const youtube = videos.data?.results ?? []
  // The library search can miss a processed song YouTube found (a description, or the library still loading).
  const readyVideos = youtube.filter(
    (r) => r.processed && !libraryIds.has(r.video_id)
  )
  const newVideos = youtube.filter((r) => !r.processed)
  const showReady =
    library.isLoading ||
    library.error !== null ||
    libraryIds.size + readyVideos.length > 0
  const showNew =
    videos.isLoading || videos.error !== null || newVideos.length > 0

  return (
    <div className='flex flex-col gap-6'>
      {showReady && (
        <ReadyToSing
          library={library}
          extra={readyVideos}
          onPlay={onPlay}
          onSelect={onSelect}
          onMoreLikeThis={onMoreLikeThis}
        />
      )}
      {library.data?.ready === false && (
        <Notice>
          The library is still loading, so some songs already in Synbox may be
          missing. Try again in a moment.
        </Notice>
      )}
      {showNew && (
        <AddFromYoutube
          videos={videos}
          results={newVideos}
          onSelect={onSelect}
        />
      )}
      {videos.data?.source === 'library_only' && (
        <Notice>
          YouTube search is unavailable right now, so only songs already in
          Synbox are shown.
        </Notice>
      )}
      {!showReady && !showNew && library.data?.ready !== false && (
        <Notice>No singable songs found for “{query}”.</Notice>
      )}
    </div>
  )
}

const SimilarSongs = ({
  videoId,
  onBack,
  onPlay,
  onMoreLikeThis,
}: {
  videoId: string
  onBack: () => void
  onPlay: (videoId: string) => void
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
            onPlay={onPlay}
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
  onPlay,
  onSelect,
  onMoreLikeThis,
}: {
  query: string
  similarTo: string
  onBack: () => void
  onPlay: (videoId: string) => void
  onSelect: (result: VideoSearchResult) => void
  onMoreLikeThis: (videoId: string) => void
}) => {
  if (similarTo !== '') {
    return (
      <SimilarSongs
        videoId={similarTo}
        onBack={onBack}
        onPlay={onPlay}
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
      onPlay={onPlay}
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
      startGeneration({
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
    <section className='flex custom-scrollbar flex-1 flex-col gap-4 overflow-y-scroll px-4 pt-page-top pb-page-bottom md:px-10'>
      <title>Search · Synbox</title>
      <form
        key={query}
        className='flex w-full gap-2 sm:mx-auto sm:w-4/5'
        onSubmit={(e) => {
          e.preventDefault()
          const value = new FormData(e.currentTarget).get('q')
          const q = typeof value === 'string' ? value.trim() : ''
          if (q !== '') {
            setParams({ q })
          }
        }}>
        <Input
          name='q'
          defaultValue={query}
          placeholder='Search for a song, or describe one: “sad songs by a female singer”'
        />
        <Button type='submit'>
          <SearchIcon className='mr-2 size-4' />
          Search
        </Button>
      </form>

      <div className='sm:mx-auto sm:w-4/5'>
        <SearchBody
          query={query}
          similarTo={similarTo}
          onBack={() => {
            setParams({ q: query })
          }}
          onPlay={handlePlay}
          onSelect={handleSelect}
          onMoreLikeThis={handleMoreLikeThis}
        />
      </div>
    </section>
  )
}

export default SearchPage
