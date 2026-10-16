import { SearchIcon } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router'

import {
  LibrarySongCard,
  VideoResultCard,
} from '@/components/search/SearchResultCards'
import DotsLoader from '@/components/shared/DotsLoader'
import RequestDialog from '@/components/shared/RequestDialog'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import useRequestDialog from '@/hooks/useRequestDialog'
import {
  useGetSimilarSongs,
  useSearchLibrary,
  useSearchVideos,
} from '@/lib/react-query/queriesAndMutations'
import type { VideoSearchResult } from '@/lib/synbox-flask/discovery'

type SearchTab = 'youtube' | 'library'

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

const YoutubeResults = ({
  query,
  onSelect,
}: {
  query: string
  onSelect: (result: VideoSearchResult) => void
}) => {
  const { data, error, isLoading } = useSearchVideos(query)
  return (
    <div className='flex flex-col gap-3'>
      {query === '' && (
        <Notice>Type a song or artist to search YouTube.</Notice>
      )}
      {isLoading && <DotsLoader />}
      {error && <Notice>{error.message}</Notice>}
      {data?.source === 'library_only' && (
        <Notice>
          YouTube search is unavailable right now, so only songs already in
          Synbox are shown.
        </Notice>
      )}
      {data?.source === 'youtube' && !data.filtered && (
        <Notice>
          Smart filtering is unavailable, so some results may not be singable.
        </Notice>
      )}
      {data?.results.length === 0 && (
        <Notice>No singable songs found for “{query}”.</Notice>
      )}
      <ResultGrid>
        {data?.results.map((result) => (
          <VideoResultCard
            key={result.video_id}
            result={result}
            onSelect={onSelect}
          />
        ))}
      </ResultGrid>
    </div>
  )
}

const LibraryResults = ({
  query,
  onPlay,
  onMoreLikeThis,
}: {
  query: string
  onPlay: (videoId: string) => void
  onMoreLikeThis: (videoId: string) => void
}) => {
  const { data, error, isLoading } = useSearchLibrary(query)
  const emptyMessage =
    data?.ready === true
      ? `No songs in the library match “${query}”.`
      : 'The library is still loading. Try again in a moment.'
  return (
    <div className='flex flex-col gap-3'>
      {query === '' && (
        <Notice>
          Describe what you want to sing, like “calm songs about the night” or
          “Ado songs that feel angry”.
        </Notice>
      )}
      {isLoading && <DotsLoader />}
      {error && <Notice>{error.message}</Notice>}
      {data?.mode === 'title_match' && (
        <Notice>
          Smart search is unavailable, so results match titles and artists only.
        </Notice>
      )}
      {data?.results.length === 0 && <Notice>{emptyMessage}</Notice>}
      <ResultGrid>
        {data?.results.map((song) => (
          <LibrarySongCard
            key={song.video_id}
            song={song}
            vocalUnknown={song.vocal_unknown}
            onPlay={onPlay}
            onMoreLikeThis={onMoreLikeThis}
          />
        ))}
      </ResultGrid>
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
      <div className='flex items-center justify-between'>
        <h2 className='text-lg font-semibold text-foreground'>
          More Like This
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

const SearchPage = () => {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const query = (params.get('q') ?? '').trim()
  const tab: SearchTab = params.get('tab') === 'library' ? 'library' : 'youtube'
  const similarTo = params.get('similar') ?? ''
  const dialog = useRequestDialog()

  const handlePlay = (videoId: string) => {
    void navigate(`/v/${videoId}`, { state: { videoId } })
  }

  const handleSelect = (result: VideoSearchResult) => {
    if (result.processed) {
      handlePlay(result.video_id)
    } else {
      dialog.openFor(result.video_id)
    }
  }

  const handleMoreLikeThis = (videoId: string) => {
    setParams({ q: query, similar: videoId, tab: 'library' })
  }

  return (
    <section className='flex custom-scrollbar flex-1 flex-col gap-4 overflow-y-scroll px-4 pt-20 pb-10 md:px-10'>
      <title>Search · Synbox</title>
      <form
        key={query}
        className='flex w-full gap-2 sm:mx-auto sm:w-4/5'
        onSubmit={(e) => {
          e.preventDefault()
          const value = new FormData(e.currentTarget).get('q')
          const q = typeof value === 'string' ? value.trim() : ''
          if (q !== '') {
            setParams({ q, tab })
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

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setParams({ q: query, tab: value })
        }}
        className='sm:mx-auto sm:w-4/5'>
        <TabsList>
          <TabsTrigger value='youtube'>YouTube</TabsTrigger>
          <TabsTrigger value='library'>My Library</TabsTrigger>
        </TabsList>
        <TabsContent value='youtube'>
          <YoutubeResults
            query={tab === 'youtube' ? query : ''}
            onSelect={handleSelect}
          />
        </TabsContent>
        <TabsContent value='library'>
          {similarTo === '' ? (
            <LibraryResults
              query={tab === 'library' ? query : ''}
              onPlay={handlePlay}
              onMoreLikeThis={handleMoreLikeThis}
            />
          ) : (
            <SimilarSongs
              videoId={similarTo}
              onBack={() => {
                setParams({ q: query, tab: 'library' })
              }}
              onPlay={handlePlay}
              onMoreLikeThis={handleMoreLikeThis}
            />
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialog.open} onOpenChange={dialog.handleOpenChange}>
        {dialog.videoId !== '' && (
          <RequestDialog
            key={dialog.dialogKey}
            videoId={dialog.videoId}
            handleClose={dialog.close}
          />
        )}
      </Dialog>
    </section>
  )
}

export default SearchPage
