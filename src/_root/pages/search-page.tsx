import type { UseQueryResult } from '@tanstack/react-query'
import {
  ArrowUpRightIcon,
  ClipboardPasteIcon,
  PlayIcon,
  SearchIcon,
  SparklesIcon,
} from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'

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
import { useMediaQuery } from '@/hooks/use-media-query'
import {
  useGetLyricsBySongId,
  useGetSimilarSongs,
  useKaraokeIds,
  useSearchLibrary,
  useSearchVideos,
  useYoutubeVideo,
} from '@/lib/react-query/queries-and-mutations'
import type {
  LibrarySearchResponse,
  VideoSearchResult,
} from '@/lib/synbox-flask/discovery'
import type { CssVars } from '@/types'
import { BAD_LINK, readFieldText } from '@/utils'

const Notice = ({ children }: { children: React.ReactNode }) => (
  <p className='rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground'>
    {children}
  </p>
)

// A search that failed: what failed and the way to try again, as the library's still-loading notice does
const Failed = ({ what, retry }: { what: string; retry: () => void }) => (
  <div className='flex flex-wrap items-center gap-3'>
    <Notice>{what}</Notice>
    <Button variant='ghost' onClick={retry}>
      Try Again
    </Button>
  </div>
)

const ResultGrid = ({ children }: { children: React.ReactNode }) => (
  // Each card pads its hover surface, so the grid reaches out by that padding and the pictures line up
  // with the search field
  <div className='-mx-2 grid grid-cols-2 gap-3 empty:hidden sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
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

// Search lists only songs with the mic badge: lyrics timed word by word, from the library list. Until that list
// is in, nothing is known to qualify, so results wait rather than show and then drop songs
const useKaraokeFilter = () => {
  const karaoke = useKaraokeIds()
  return {
    error: karaoke.error,
    has: (videoId: string) => karaoke.data?.has(videoId) === true,
    retry: () => {
      void karaoke.refetch()
    },
    waiting: karaoke.data === undefined && karaoke.error === null,
  }
}

const youtubeSearchUrl = (query: string) =>
  query === ''
    ? 'https://www.youtube.com'
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`

// Search finds only songs we already have lyrics for. Any other song is added by its YouTube link: Paste Link reads
// one copied on YouTube (Look Up on YouTube opens its search there); where the browser can't read the clipboard, or
// what it holds is no video link, the field takes the paste instead
const AddByLink = ({
  query,
  none,
  onLink,
  focusField,
}: {
  query: string
  none: boolean
  onLink: (text: string) => void
  focusField: () => void
}) => {
  const [hint, setHint] = useState('')
  const canRead = typeof navigator.clipboard?.readText === 'function'
  const paste = async () => {
    const copied = await navigator.clipboard.readText().catch(() => '')
    const { kind } = readFieldText(copied)
    if (kind === 'video' || kind === 'own') {
      setHint('')
      onLink(copied)
      return
    }
    setHint('Copy a YouTube video link, then paste it here')
    focusField()
  }
  return (
    <div className='flex flex-col gap-3'>
      <output className='text-sm text-muted-foreground'>
        {none ? 'No results. ' : 'Not here? '}Paste its YouTube link to add it.
      </output>
      <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
        {canRead && (
          <Button
            variant='outline'
            gap='sm'
            className='touch:h-11'
            onClick={() => {
              void paste()
            }}>
            <ClipboardPasteIcon aria-hidden className='size-4 shrink-0' />
            Paste Link
          </Button>
        )}
        <Button asChild variant='outline' gap='sm' className='touch:h-11'>
          <a
            href={youtubeSearchUrl(query)}
            target='_blank'
            rel='noopener noreferrer'>
            Look Up on YouTube
            <span className='sr-only'> (opens in a new tab)</span>
            <ArrowUpRightIcon
              aria-hidden
              className='size-4 shrink-0 text-muted-foreground'
            />
          </a>
        </Button>
      </div>
      <output className='text-sm text-muted-foreground empty:hidden'>
        {hint}
      </output>
    </div>
  )
}

// A pasted YouTube link: that one video, whatever it is. A song with lyrics plays; any other is generated, through
// the same check as every Generate Lyrics button (its refusal, Sign In included, shows as a notice)
const LinkedVideo = ({ videoId }: { videoId: string }) => {
  const video = useYoutubeVideo(videoId)
  const lyrics = useGetLyricsBySongId(videoId)
  if (video.error) {
    return video.error.message.startsWith('No video found') ? (
      <Notice>This video isn’t on YouTube.</Notice>
    ) : (
      <Failed
        what="Couldn't look up this link."
        retry={() => {
          void video.refetch()
        }}
      />
    )
  }
  const title = video.data?.title ?? ''
  const action = () => {
    if (lyrics.isLoading || video.data === undefined) {
      return <Skeleton className='h-10 w-40 touch:h-11' />
    }
    if (lyrics.data) {
      return (
        <Button asChild gap='sm' className='self-start touch:h-11'>
          <Link to={`/v/${videoId}`} state={{ videoId }}>
            <PlayIcon aria-hidden className='size-4 shrink-0 fill-current' />
            Play Video
          </Link>
        </Button>
      )
    }
    return (
      <Button
        gap='sm'
        className='self-start touch:h-11'
        onClick={() => {
          void startFromButton({ mode: 'new', title, videoId })
        }}>
        <SparklesIcon aria-hidden className='size-4 shrink-0' />
        Generate Lyrics
      </Button>
    )
  }
  return (
    <div
      data-bench='search-result'
      className='flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5'>
      <div className='relative aspect-video w-full overflow-hidden rounded-lg bg-input sm:w-64 sm:shrink-0'>
        {video.data !== undefined && (
          <img
            src={video.data.thumbnail}
            alt=''
            className='absolute inset-0 h-full w-full object-cover'
          />
        )}
      </div>
      <div className='flex min-w-0 flex-col gap-3'>
        {video.data === undefined ? (
          <div className='flex flex-col gap-2'>
            <Skeleton className='h-4 w-56 max-w-full' />
            <Skeleton className='h-3 w-32' />
          </div>
        ) : (
          <div className='flex min-w-0 flex-col gap-1'>
            <p className='line-clamp-2 font-semibold wrap-anywhere text-foreground'>
              {title}
            </p>
            <p className='truncate text-sm text-muted-foreground'>
              {video.data.channelTitle}
            </p>
          </div>
        )}
        {action()}
      </div>
    </div>
  )
}

// What the library search says besides its songs: an error, or that it is not at its best
const LibraryStatus = ({
  library,
  searching,
}: {
  library: UseQueryResult<LibrarySearchResponse>
  searching: boolean
}) => {
  const notReady = library.data?.ready === false
  if (searching) {
    return null
  }
  if (library.error) {
    return (
      <Failed
        what="Couldn't search the songs."
        retry={() => {
          void library.refetch()
        }}
      />
    )
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
  return library.data?.mode === 'title_match' ? (
    <Notice>Smart search is down. Matching titles only.</Notice>
  ) : null
}

// Only karaoke songs (the mic badge): the library's matches, then any the YouTube search found that the library
// search missed (an English title, or the library still loading). A pasted link never gets here (LinkedVideo)
const SearchResults = ({
  query,
  onSelect,
  onMoreLikeThis,
  onLink,
  focusField,
}: {
  query: string
  onSelect: (result: VideoSearchResult) => void
  onMoreLikeThis: (videoId: string) => void
  onLink: (text: string) => void
  focusField: () => void
}) => {
  const library = useSearchLibrary(query)
  const videos = useSearchVideos(query)
  const karaoke = useKaraokeFilter()
  const libraryResults = (library.data?.results ?? []).filter((s) =>
    karaoke.has(s.video_id)
  )
  const libraryIds = new Set(libraryResults.map((s) => s.video_id))
  const extra = (videos.data?.results ?? []).filter(
    (r) => karaoke.has(r.video_id) && !libraryIds.has(r.video_id)
  )
  // A retry after the library gave up has data already, so isLoading stays false while it waits again
  const notReady = library.data?.ready === false
  const searching =
    library.isLoading ||
    (notReady && library.isFetching) ||
    karaoke.waiting ||
    (libraryResults.length === 0 && extra.length === 0 && videos.isLoading)
  const [inner, height] = useContentHeight()
  const heightVars: CssVars | undefined =
    height === null ? undefined : { '--smooth-h': `${height}px` }
  return (
    <div style={heightVars} className='smooth-height'>
      <div ref={inner} className='flex flex-col gap-6'>
        <div className='flex flex-col gap-3 empty:hidden'>
          <LibraryStatus library={library} searching={searching} />
          {karaoke.error && (
            <Failed what="Couldn't load the songs." retry={karaoke.retry} />
          )}
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
        <AddByLink
          query={query}
          onLink={onLink}
          focusField={focusField}
          none={
            !searching &&
            library.error === null &&
            karaoke.error === null &&
            libraryResults.length + extra.length === 0
          }
        />
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
  const { data, error, isLoading, refetch } = useGetSimilarSongs(videoId)
  const karaoke = useKaraokeFilter()
  const songs = karaoke.waiting
    ? undefined
    : data?.results.filter((song) => karaoke.has(song.video_id))
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between gap-4'>
        <h2 className='min-w-0 truncate text-lg font-semibold text-foreground'>
          More Like {data?.song?.title ?? 'This'}
        </h2>
        <Button variant='ghost' onClick={onBack}>
          Back to Results
        </Button>
      </div>
      {(isLoading || (data !== undefined && karaoke.waiting)) && <DotsLoader />}
      {karaoke.error && (
        <Failed what="Couldn't load the songs." retry={karaoke.retry} />
      )}
      {error && (
        <Failed
          what="Couldn't load similar songs."
          retry={() => {
            void refetch()
          }}
        />
      )}
      {songs?.length === 0 && karaoke.error === null && (
        <Notice>No similar songs yet.</Notice>
      )}
      <ResultGrid>
        {songs?.map((song) => (
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

// Two queries a tap away, which show that a mood works too. Each names one of the two broadest moods the backend
// filters by (sad takes bittersweet songs too, happy takes hopeful ones) and nothing narrower, so both keep finding
// songs as the library changes: a mood plus a theme or an artist ("calm songs about the night") can find none
const EXAMPLES = ['Songs for a good cry', 'Songs to cheer you up']

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
  onLink,
  focusField,
}: {
  query: string
  similarTo: string
  onSearch: (query: string) => void
  onBack: () => void
  onSelect: (result: VideoSearchResult) => void
  onMoreLikeThis: (videoId: string) => void
  onLink: (text: string) => void
  focusField: () => void
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
  const text = readFieldText(query)
  if (text.kind === 'empty') {
    return <Examples onSearch={onSearch} />
  }
  if (text.kind === 'own') {
    return <Navigate to={text.path} replace />
  }
  if (text.kind === 'video') {
    return <LinkedVideo videoId={text.videoId} />
  }
  if (text.kind === 'bad') {
    return (
      <p role='alert' className='text-sm text-error-strong'>
        {BAD_LINK}
      </p>
    )
  }
  return (
    <SearchResults
      query={query}
      onSelect={onSelect}
      onMoreLikeThis={onMoreLikeThis}
      onLink={onLink}
      focusField={focusField}
    />
  )
}

const SearchPage = () => {
  const [box, setBox] = useState<HTMLElement | null>(null)
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const query = (params.get('q') ?? '').trim()
  const similarTo = params.get('similar') ?? ''
  const field = useRef<HTMLInputElement>(null)
  // Under 360px wide the full text runs past the field, as Home's does
  const roomy = useMediaQuery('(min-width: 22.5rem)')

  // A search or a link, as typed, pasted or read by Paste Link: our own song link opens in place
  const submit = (value: string) => {
    const text = readFieldText(value)
    if (text.kind === 'own') {
      void navigate(text.path)
    } else if (text.kind !== 'empty') {
      setParams({ q: value.trim() })
    }
  }

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
      className='flex flex-1 flex-col gap-4 overflow-y-scroll pt-page-top page-x pb-page-bottom'>
      <title>Search · Synbox</title>
      <h1 className='sr-only'>Search</h1>
      <form
        key={query}
        className='w-full sm:mx-auto sm:w-4/5'
        onSubmit={(e) => {
          e.preventDefault()
          const value = new FormData(e.currentTarget).get('q')
          submit(typeof value === 'string' ? value : '')
        }}>
        {/* The home page's field: a pill with its action inside, an icon on phones and a labelled one wider */}
        <InputField>
          <Input
            ref={field}
            name='q'
            defaultValue={query}
            aria-label='Search songs or paste a YouTube link'
            enterKeyHint='search'
            autoCapitalize='off'
            autoCorrect='off'
            spellCheck={false}
            placeholder={
              roomy ? 'Song, artist or YouTube link' : 'Song or YouTube link'
            }
            // A link pasted over the whole field needs no Search press: it names one video, not words to search
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text')
              const { kind } = readFieldText(pasted)
              const { selectionEnd, selectionStart, value } = e.currentTarget
              const replacesAll =
                value.trim() === '' ||
                (selectionStart === 0 && selectionEnd === value.length)
              if ((kind === 'video' || kind === 'own') && replacesAll) {
                e.preventDefault()
                submit(pasted)
              }
            }}
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
          onLink={submit}
          focusField={() => {
            field.current?.focus()
          }}
        />
      </div>
      <BoxScrollbar box={box} />
    </section>
  )
}

export default SearchPage
