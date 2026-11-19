import { useQueryClient } from '@tanstack/react-query'
import {
  CheckIcon,
  CircleAlertIcon,
  PlusIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react'
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { offerUndo } from '@/components/shared/offer-undo'
import { SearchField } from '@/components/shared/search-field'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { SortableList } from '@/components/watch/sortable-list'
import {
  RecommendationsFullError,
  useAddRecommendation,
  useAdminRecommendations,
  useSaveRecommendations,
} from '@/lib/admin'
import { getSongInfoBySongId } from '@/lib/appwrite/api'
import { useGallerySongs } from '@/lib/react-query/queries-and-mutations'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'
import { MAX_RECOMMENDATIONS, toRecommendation } from '@/lib/recommendations'
import type { Recommendation } from '@/lib/recommendations'
import { fold } from '@/lib/text-search'
import { getYoutubeVideoInfo } from '@/lib/youtube/api'
import { extractVideoId } from '@/utils'

// The carousel's size: 480x360, as the playlist gave it before
const thumbnailOf = (videoId: string) =>
  `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

const LIBRARY_RESULTS = 8

// A song the field found, with its Add
const Result = ({
  videoId,
  title,
  author,
  added,
  disabled,
  label,
  onAdd,
}: {
  videoId: string
  title: string
  author: string
  added: boolean
  disabled: boolean
  label: string
  onAdd: () => void
}) => (
  <li className='flex min-h-14 items-center gap-3 py-1.5'>
    <img
      src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
      alt=''
      width='320'
      height='180'
      loading='lazy'
      decoding='async'
      className='aspect-video w-16 shrink-0 rounded-sm bg-thumbnail-placeholder object-cover'
    />
    <div className='min-w-0 flex-1'>
      <p className='line-clamp-1 text-sm font-medium text-foreground'>
        {title}
      </p>
      <span className='block truncate text-xs text-muted-foreground'>
        {author}
      </span>
    </div>
    <Button
      type='button'
      variant='outline'
      size='sm'
      gap='sm'
      disabled={added || disabled}
      aria-label={added ? `Added: ${title}` : `${label}: ${title}`}
      onClick={onAdd}>
      {!added && <PlusIcon className='size-4' aria-hidden />}
      {added ? 'Added' : label}
    </Button>
  </li>
)

// The line under the field: what went wrong, why nothing can be added, or that the words found nothing
const addNote = ({
  error,
  full,
  missed,
  query,
}: {
  error: string
  full: boolean
  missed: boolean
  query: string
}) => {
  if (error !== '') {
    return error
  }
  if (full) {
    return `The list holds at most ${MAX_RECOMMENDATIONS} songs`
  }
  return missed ? `No library song matches “${query}”` : ''
}

// One field to add a song to the end of the list. Typed words find songs in our library (they all have lyrics) by
// title or channel, in any order; a pasted YouTube or Synbox link, or a video id, offers that video first, and Enter
// adds it
const AddSongs = ({
  songs,
  onAdd,
}: {
  songs: Recommendation[]
  onAdd: (song: Recommendation) => void
}) => {
  const queryClient = useQueryClient()
  const { songs: library, isPending } = useGallerySongs()
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const listed = new Set(songs.map((song) => song.videoId))
  const full = songs.length >= MAX_RECOMMENDATIONS
  // A link or an id is one word; extractVideoId logs an error for text it can't read as an address
  const trimmed = query.trim()
  const linked =
    trimmed === '' || /\s/u.test(trimmed) ? null : extractVideoId(trimmed)
  const words = fold(query).split(/\s+/u).filter(Boolean)
  const matches =
    words.length === 0
      ? []
      : library
          .filter((song) => {
            const text = fold(`${song.title} ${song.author}`)
            return (
              song.videoId !== linked &&
              words.every((word) => text.includes(word))
            )
          })
          .slice(0, LIBRARY_RESULTS)

  // A pasted link's video: ours when we have it, else YouTube's details, fetched on Add
  const addLinked = async (videoId: string) => {
    if (listed.has(videoId)) {
      setError('Already in the list')
      return
    }
    const ours = library.find((song) => song.videoId === videoId)
    if (ours !== undefined) {
      onAdd({
        author: ours.author,
        thumbnailUrl: thumbnailOf(videoId),
        title: ours.title,
        videoId,
      })
      setQuery('')
      return
    }
    setPending(true)
    const info = await queryClient
      .query({
        queryFn: async () => await getYoutubeVideoInfo(videoId),
        queryKey: [QUERY_KEYS.GET_YOUTUBE_VIDEO_INFO, videoId],
      })
      .catch(() => null)
    setPending(false)
    if (info === null) {
      setError("Couldn't load that video. Check the link")
      return
    }
    onAdd({
      author: info.channelTitle,
      thumbnailUrl: thumbnailOf(videoId),
      title: info.title,
      videoId,
    })
    setQuery('')
  }

  const linkedSong =
    linked === null ? null : library.find((song) => song.videoId === linked)
  const note = addNote({
    error,
    full,
    missed: words.length > 0 && linked === null && matches.length === 0,
    query: trimmed,
  })

  return (
    <form
      className='flex flex-col gap-2'
      onSubmit={(event) => {
        event.preventDefault()
        if (linked !== null && !full && !pending) {
          void addLinked(linked)
        }
      }}>
      <SearchField
        label='Add a Song'
        placeholder={
          isPending ? 'Loading Our Songs…' : 'Title, Artist or YouTube Link'
        }
        value={query}
        onChange={(next) => {
          setQuery(next)
          setError('')
        }}
        className='w-full sm:max-w-sm'
      />
      <p
        aria-live='polite'
        className={
          error === '' ? 'text-xs text-muted-foreground' : 'text-xs text-error'
        }>
        {note}
      </p>
      {(linked !== null || matches.length > 0) && (
        <ul aria-label='Matching Songs' className='flex flex-col'>
          {linked !== null && (
            <Result
              videoId={linked}
              title={linkedSong?.title ?? 'YouTube Video'}
              author={linkedSong?.author ?? linked}
              added={listed.has(linked)}
              disabled={full || pending}
              label={pending ? 'Adding…' : 'Add Song'}
              onAdd={() => {
                void addLinked(linked)
              }}
            />
          )}
          {matches.map((song) => (
            <Result
              key={song.videoId}
              videoId={song.videoId}
              title={song.title}
              author={song.author}
              added={listed.has(song.videoId)}
              disabled={full}
              label='Add'
              onAdd={() => {
                onAdd({
                  author: song.author,
                  thumbnailUrl: thumbnailOf(song.videoId),
                  title: song.title,
                  videoId: song.videoId,
                })
              }}
            />
          ))}
        </ul>
      )}
    </form>
  )
}

// One song in the list: the grip to drag it (or focus it and press the arrow keys), its picture and title, and
// Remove
const Row = ({
  song,
  index,
  grip,
  onRemove,
}: {
  song: Recommendation
  index: number
  grip: ReactNode
  onRemove: () => void
}) => (
  <div
    data-video-id={song.videoId}
    className='flex min-h-16 items-center gap-3 border-t border-border py-2'>
    {grip}
    <span className='hidden w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block'>
      {index + 1}
    </span>
    <img
      src={song.thumbnailUrl}
      alt=''
      width='480'
      height='360'
      loading='lazy'
      decoding='async'
      className='aspect-video w-16 shrink-0 rounded-sm bg-thumbnail-placeholder object-cover sm:w-20'
    />
    <div className='min-w-0 flex-1'>
      <p className='line-clamp-2 text-sm leading-5 font-medium text-pretty text-foreground'>
        <Link to={`/v/${song.videoId}`} className='hover:underline'>
          {song.title}
        </Link>
      </p>
      <span className='block truncate text-xs text-muted-foreground'>
        {song.author}
      </span>
    </div>
    <Button
      variant='row-icon'
      size='icon'
      data-action='remove'
      aria-label={`Remove: ${song.title}`}
      title='Remove'
      onClick={onRemove}>
      <XIcon className='size-4' />
    </Button>
  </div>
)

// Says how adding to Recommended went, wherever an admin adds from
const useAddFeedback = () => {
  const { toast } = useToast()
  return {
    added: (song: Recommendation) => {
      toast({
        description: song.title,
        duration: 2500,
        title: 'Added to Recommended',
      })
    },
    failed: (error: Error) => {
      toast({
        title:
          error instanceof RecommendationsFullError
            ? 'Recommended Is Full'
            : "Couldn't Add to Recommended",
        variant: 'destructive',
      })
    },
  }
}

// A song from the Songs table, added to the end of Recommended with its title and artist from our song info,
// or YouTube's for a video we don't have. Ticked once it's in the list
export const RecommendButton = ({ videoId }: { videoId: string }) => {
  const { data: songs } = useAdminRecommendations()
  const add = useAddRecommendation()
  const feedback = useAddFeedback()
  const [looking, setLooking] = useState(false)
  const listed = songs?.some((song) => song.videoId === videoId) ?? false
  const busy = looking || add.isPending
  const recommend = async () => {
    setLooking(true)
    const ours = await getSongInfoBySongId(videoId).catch(() => null)
    const song =
      ours === null
        ? await getYoutubeVideoInfo(videoId)
            .then((info) => ({
              author: info.channelTitle,
              thumbnailUrl: thumbnailOf(videoId),
              title: info.title,
              videoId,
            }))
            .catch(() => null)
        : toRecommendation(ours)
    setLooking(false)
    if (song === null) {
      feedback.failed(new Error('No song info'))
      return
    }
    add.mutate(song, {
      onError: feedback.failed,
      onSuccess: () => {
        feedback.added(song)
      },
    })
  }
  return (
    <Button
      variant='row-icon'
      size='icon'
      disabled={songs === undefined || listed || busy}
      aria-label={listed ? 'In Recommended' : 'Add to Recommended'}
      title={listed ? 'In Recommended' : 'Add to Recommended'}
      onClick={() => {
        void recommend()
      }}>
      {listed ? (
        <CheckIcon className='size-4 text-primary-text' />
      ) : (
        <SparklesIcon className='size-4' />
      )}
    </Button>
  )
}

const RECOMMENDATIONS_KEY = [QUERY_KEYS.GET_ADMIN_RECOMMENDATIONS]

// The landing page's carousel, in the order saved (each visitor sees it shuffled). Every change saves at once:
// an add, a removal (one press, then Undo puts it back where it was), a move. A failed save puts the list back as
// it was
export const RecommendationsEditor = () => {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: saved, error, refetch } = useAdminRecommendations()
  const save = useSaveRecommendations()
  const addSong = useAddRecommendation()
  const feedback = useAddFeedback()
  const [announcement, setAnnouncement] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const songs = saved ?? []

  if (error !== null) {
    return (
      <p
        role='alert'
        className='flex items-center gap-2 text-sm text-muted-foreground'
        title={error.message}>
        <CircleAlertIcon aria-hidden className='size-4 shrink-0 text-error' />
        Couldn&apos;t load recommendations
        <Button
          variant='quiet'
          size='text'
          onClick={() => {
            void refetch()
          }}>
          Retry
        </Button>
      </p>
    )
  }
  if (saved === undefined) {
    return (
      <ul aria-hidden className='flex flex-col'>
        {Array.from({ length: 6 }, (_, row) => (
          <li
            key={row}
            className='flex min-h-16 items-center gap-3 border-t border-border py-2'>
            <Skeleton className='aspect-video w-16 shrink-0 sm:w-20' />
            <div className='flex flex-1 flex-col gap-2'>
              <Skeleton className='h-3.5 w-1/2' />
              <Skeleton className='h-3 w-1/4' />
            </div>
          </li>
        ))}
      </ul>
    )
  }

  // Shows the new list at once and saves it; puts the one it replaced back if the save fails
  const commit = (
    next: Recommendation[],
    previous: Recommendation[],
    onSaved?: () => void
  ) => {
    queryClient.setQueryData(RECOMMENDATIONS_KEY, next)
    save.mutate(next, {
      onError: () => {
        queryClient.setQueryData(RECOMMENDATIONS_KEY, previous)
        toast({
          description: 'Nothing changed. Try again',
          title: "Couldn't Save Recommended",
          variant: 'destructive',
        })
      },
      onSuccess: onSaved,
    })
  }

  // Puts a removed song back at its place in the list as it is now, unless it came back another way
  const restore = (song: Recommendation, index: number) => {
    const current =
      queryClient.getQueryData<Recommendation[]>(RECOMMENDATIONS_KEY) ?? []
    if (current.some((item) => item.videoId === song.videoId)) {
      return
    }
    commit(
      current.toSpliced(Math.min(index, current.length), 0, song),
      current,
      () => {
        setAnnouncement(`Restored ${song.title}`)
      }
    )
  }

  // One press removes; the toast's Undo brings it back. The keyboard goes to the row that took its place
  const remove = (song: Recommendation) => {
    const index = songs.findIndex((item) => item.videoId === song.videoId)
    if (index === -1) {
      return
    }
    if (songs.length === 1) {
      toast({
        title: 'Recommended Needs One Song',
        variant: 'destructive',
      })
      return
    }
    const next = songs.toSpliced(index, 1)
    const hadFocus = list.current?.contains(document.activeElement) ?? false
    commit(next, songs, () => {
      setAnnouncement(`Removed ${song.title}`)
      offerUndo('Removed from Recommended', () => {
        restore(song, index)
      })
    })
    const after = next[Math.min(index, next.length - 1)]?.videoId
    if (hadFocus && after !== undefined) {
      requestAnimationFrame(() => {
        list.current
          ?.querySelector<HTMLButtonElement>(
            `[data-video-id="${after}"] [data-action="remove"]`
          )
          ?.focus()
      })
    }
  }

  const add = (song: Recommendation) => {
    addSong.mutate(song, {
      onError: feedback.failed,
      onSuccess: () => {
        setAnnouncement(`Added ${song.title}`)
        feedback.added(song)
      },
    })
  }

  return (
    <div className='flex flex-col gap-4'>
      <AddSongs songs={songs} onAdd={add} />
      {songs.length === 0 ? (
        <p className='py-6 text-center text-sm text-muted-foreground'>
          The list is empty
        </p>
      ) : (
        <div ref={list}>
          <SortableList
            items={songs}
            keyOf={(song) => song.videoId}
            labelOf={(song) => song.title}
            onMove={(from, to) => {
              commit(
                songs.toSpliced(from, 1).toSpliced(to, 0, songs[from]),
                songs
              )
            }}
            renderItem={(song, grip, index) => (
              <Row
                song={song}
                index={index}
                grip={grip}
                onRemove={() => {
                  remove(song)
                }}
              />
            )}
          />
        </div>
      )}
      <p className='border-t border-border pt-4 text-sm text-muted-foreground tabular-nums'>
        {songs.length === 1 ? '1 song' : `${songs.length} songs`}
        {save.isPending && ' · Saving…'}
      </p>
      <output className='sr-only'>{announcement}</output>
    </div>
  )
}
