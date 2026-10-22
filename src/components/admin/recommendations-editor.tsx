import { useQueryClient } from '@tanstack/react-query'
import { CheckIcon, PlusIcon, SparklesIcon, XIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { KaraokeMark } from '@/components/shared/karaoke-badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { getYoutubeVideoInfo } from '@/lib/youtube/api'
import { extractVideoId } from '@/utils'

// The carousel's size: 480x360, as the playlist gave it before
const thumbnailOf = (videoId: string) =>
  `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

const LIBRARY_RESULTS = 8
const fold = (text: string) => text.normalize('NFKC').toLowerCase()

// Songs from our own library, which all have their lyrics, found by words of the title or the channel in any
// order; one press adds a song to the end of the list
const LibrarySearch = ({
  songs,
  onAdd,
}: {
  songs: Recommendation[]
  onAdd: (song: Recommendation) => void
}) => {
  const { songs: library, isPending } = useGallerySongs()
  const [query, setQuery] = useState('')
  const listed = new Set(songs.map((song) => song.videoId))
  const full = songs.length >= MAX_RECOMMENDATIONS
  const words = fold(query).split(/\s+/u).filter(Boolean)
  const matches =
    words.length === 0
      ? []
      : library
          .filter((song) => {
            const text = fold(`${song.title} ${song.author}`)
            return words.every((word) => text.includes(word))
          })
          .slice(0, LIBRARY_RESULTS)

  return (
    <div className='flex flex-col gap-2'>
      <Input
        type='search'
        name='library'
        autoComplete='off'
        aria-label='Search Our Songs'
        placeholder={
          isPending
            ? 'Loading our songs…'
            : 'Search our songs by title or artist'
        }
        value={query}
        className='h-10'
        onChange={(event) => {
          setQuery(event.target.value)
        }}
      />
      {words.length > 0 &&
        (matches.length === 0 ? (
          <p className='text-xs text-muted-foreground'>
            No song in our library matches “{query.trim()}”.
          </p>
        ) : (
          <ul aria-label='Matching Songs' className='flex flex-col'>
            {matches.map((song) => {
              const added = listed.has(song.videoId)
              return (
                <li
                  key={song.videoId}
                  className='flex min-h-14 items-center gap-3 py-1.5'>
                  <img
                    src={`https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg`}
                    alt=''
                    width='320'
                    height='180'
                    loading='lazy'
                    decoding='async'
                    className='aspect-video w-16 shrink-0 rounded-sm bg-thumbnail-placeholder object-cover'
                  />
                  <div className='min-w-0 flex-1'>
                    <p className='line-clamp-1 text-sm font-medium text-foreground'>
                      {song.title}
                    </p>
                    <span className='block truncate text-xs text-muted-foreground'>
                      {song.author}
                    </span>
                  </div>
                  <span className='flex w-4 shrink-0 justify-center'>
                    <KaraokeMark videoId={song.videoId} />
                  </span>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={added || full}
                    aria-label={
                      added ? `Added: ${song.title}` : `Add: ${song.title}`
                    }
                    onClick={() => {
                      onAdd({
                        author: song.author,
                        thumbnailUrl: thumbnailOf(song.videoId),
                        title: song.title,
                        videoId: song.videoId,
                      })
                    }}>
                    {added ? 'Added' : 'Add'}
                  </Button>
                </li>
              )
            })}
          </ul>
        ))}
    </div>
  )
}

const AddSong = ({
  songs,
  onAdd,
}: {
  songs: Recommendation[]
  onAdd: (song: Recommendation) => void
}) => {
  const queryClient = useQueryClient()
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const full = songs.length >= MAX_RECOMMENDATIONS
  const hint = full
    ? `The list holds at most ${MAX_RECOMMENDATIONS} songs.`
    : 'Or any YouTube or Synbox link, or a video ID. Added to the end, saved at once.'

  // The field keeps focus on an error, so the fix is one keystroke away
  const refuse = (message: string) => {
    setError(message)
    field.current?.focus()
  }

  const add = async () => {
    const videoId = extractVideoId(value)
    if (videoId === null) {
      refuse('Paste a YouTube link or an 11-character video ID.')
      return
    }
    if (songs.some((song) => song.videoId === videoId)) {
      refuse('That song is already in the list. Paste a different one.')
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
      refuse(
        "Couldn't load that video from YouTube. Check the link and try again."
      )
      return
    }
    onAdd({
      author: info.channelTitle,
      thumbnailUrl: thumbnailOf(videoId),
      title: info.title,
      videoId,
    })
    setValue('')
  }

  return (
    <form
      className='flex flex-col gap-1.5'
      onSubmit={(event) => {
        event.preventDefault()
        void add()
      }}>
      <div className='flex gap-2'>
        <Input
          ref={field}
          name='video'
          autoComplete='off'
          spellCheck={false}
          aria-label='YouTube Link or Video ID'
          aria-invalid={error !== '' || undefined}
          aria-describedby='add-recommendation-hint'
          placeholder='https://youtu.be/ZRtdQ81jPUQ'
          value={value}
          disabled={full}
          className='h-10 min-w-0 flex-1'
          onChange={(event) => {
            setValue(event.target.value)
            setError('')
          }}
        />
        <Button
          type='submit'
          variant='outline'
          gap='sm'
          disabled={full || pending}>
          <PlusIcon className='size-4' aria-hidden />
          {pending ? 'Adding…' : 'Add Song'}
        </Button>
      </div>
      <p
        id='add-recommendation-hint'
        aria-live='polite'
        className={
          error === '' ? 'text-xs text-muted-foreground' : 'text-xs text-error'
        }>
        {error === '' ? hint : error}
      </p>
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
    {/* A column of its own, so the marks line up down the list */}
    <span className='flex w-4 shrink-0 justify-center'>
      <KaraokeMark videoId={song.videoId} />
    </span>
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

// The landing page's carousel, in the order saved (each visitor sees it shuffled). Every change saves at once:
// an add, a confirmed removal, a move. A failed save puts the list back as it was
export const RecommendationsEditor = () => {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: saved, error } = useAdminRecommendations()
  const save = useSaveRecommendations()
  const addSong = useAddRecommendation()
  const feedback = useAddFeedback()
  const [announcement, setAnnouncement] = useState('')
  // The song whose Remove was pressed, until the confirm answers
  const [removing, setRemoving] = useState<Recommendation | null>(null)
  // The row whose Remove takes the keyboard when the confirm closes: the pressed one, or after a removal the
  // one now in its place. The dialog's own restore lost it in both engines (Safari never focuses a pressed button)
  const refocus = useRef<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const songs = saved ?? []

  if (error !== null) {
    return <p className='text-sm text-error'>{error.message}</p>
  }
  if (saved === undefined) {
    return <Skeleton className='h-40 w-full' />
  }

  // Shows the new list at once and saves it; puts the old one back if the save fails
  const commit = (next: Recommendation[], onSaved?: () => void) => {
    const key = [QUERY_KEYS.GET_ADMIN_RECOMMENDATIONS]
    queryClient.setQueryData(key, next)
    save.mutate(next, {
      onError: () => {
        queryClient.setQueryData(key, saved)
        toast({
          description: 'The list is unchanged. Try again.',
          title: "Couldn't Save Recommended",
          variant: 'destructive',
        })
      },
      onSuccess: onSaved,
    })
  }

  // After a removal the keyboard goes to the row that took the removed one's place
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
    refocus.current = next[Math.min(index, next.length - 1)]?.videoId ?? null
    commit(next, () => {
      setAnnouncement(`Removed ${song.title}.`)
      toast({
        description: song.title,
        duration: 2500,
        title: 'Removed from Recommended',
      })
    })
  }

  const add = (song: Recommendation) => {
    addSong.mutate(song, {
      onError: feedback.failed,
      onSuccess: () => {
        setAnnouncement(`Added ${song.title}.`)
        feedback.added(song)
      },
    })
  }

  return (
    <div className='flex flex-col gap-4'>
      <LibrarySearch songs={songs} onAdd={add} />
      <AddSong songs={songs} onAdd={add} />
      {songs.length === 0 ? (
        <p className='py-6 text-center text-sm text-muted-foreground'>
          The list is empty.
        </p>
      ) : (
        <div ref={list}>
          <SortableList
            items={songs}
            keyOf={(song) => song.videoId}
            labelOf={(song) => song.title}
            onMove={(from, to) => {
              commit(songs.toSpliced(from, 1).toSpliced(to, 0, songs[from]))
            }}
            renderItem={(song, grip, index) => (
              <Row
                song={song}
                index={index}
                grip={grip}
                onRemove={() => {
                  refocus.current = song.videoId
                  setRemoving(song)
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
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null)
          }
        }}>
        <AlertDialogContent
          aria-describedby={undefined}
          className='max-w-xs'
          onCloseAutoFocus={(event) => {
            const videoId = refocus.current
            refocus.current = null
            const button =
              videoId === null
                ? null
                : list.current?.querySelector<HTMLButtonElement>(
                    `[data-video-id="${videoId}"] [data-action="remove"]`
                  )
            if (button) {
              event.preventDefault()
              button.focus()
            }
          }}>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Song?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing !== null) {
                  remove(removing)
                }
              }}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <output className='sr-only'>{announcement}</output>
    </div>
  )
}
