import { useQueryClient } from '@tanstack/react-query'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router'

import { KaraokeMark } from '@/components/shared/karaoke-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useAdminRecommendations, useSaveRecommendations } from '@/lib/admin'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'
import { MAX_RECOMMENDATIONS } from '@/lib/recommendations'
import type { Recommendation } from '@/lib/recommendations'
import { getYoutubeVideoInfo } from '@/lib/youtube/api'
import { extractVideoId } from '@/utils'

type Action = 'up' | 'down' | 'remove'

const sameOrder = (a: Recommendation[], b: Recommendation[]) =>
  a.length === b.length &&
  a.every((song, index) => song.videoId === b[index].videoId)

// The carousel's size: 480x360, as the playlist gave it before
const thumbnailOf = (videoId: string) =>
  `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

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
    : 'A YouTube link or video ID. Added songs go to the end of the list.'

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

const Row = ({
  song,
  index,
  count,
  onAction,
}: {
  song: Recommendation
  index: number
  count: number
  onAction: (action: Action) => void
}) => (
  <li
    data-video-id={song.videoId}
    // A phone puts the controls on a line of their own, so the title keeps the width to be read
    className='flex min-h-16 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border py-2 sm:flex-nowrap'>
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
    <div className='min-w-40 flex-1 sm:min-w-0'>
      <p className='line-clamp-2 text-sm leading-5 font-medium text-pretty text-foreground'>
        <Link to={`/v/${song.videoId}`} className='hover:underline'>
          {song.title}
        </Link>
      </p>
      <span className='block truncate text-xs text-muted-foreground'>
        {song.author}
      </span>
    </div>
    <div className='ml-auto flex shrink-0 items-center gap-3'>
      {/* A column of its own, so the marks line up down the list */}
      <span className='flex w-4 justify-center'>
        <KaraokeMark videoId={song.videoId} />
      </span>
      <div className='flex'>
        <Button
          variant='row-icon'
          size='icon'
          data-action='up'
          aria-label={`Move Up: ${song.title}`}
          title='Move Up'
          disabled={index === 0}
          onClick={() => {
            onAction('up')
          }}>
          <ArrowUpIcon className='size-4' />
        </Button>
        <Button
          variant='row-icon'
          size='icon'
          data-action='down'
          aria-label={`Move Down: ${song.title}`}
          title='Move Down'
          disabled={index === count - 1}
          onClick={() => {
            onAction('down')
          }}>
          <ArrowDownIcon className='size-4' />
        </Button>
        <Button
          variant='row-icon'
          size='icon'
          data-action='remove'
          aria-label={`Remove: ${song.title}`}
          title='Remove'
          onClick={() => {
            onAction('remove')
          }}>
          <XIcon className='size-4' />
        </Button>
      </div>
    </div>
  </li>
)

// The landing page's carousel, in the order saved (each visitor sees it shuffled). Edits stay on this page
// until Save Changes
export const RecommendationsEditor = () => {
  const { toast } = useToast()
  const { data: saved, error } = useAdminRecommendations()
  const { isPending: saving, mutate: save } = useSaveRecommendations()
  const [draft, setDraft] = useState<Recommendation[] | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const list = useRef<HTMLOListElement>(null)
  const songs = draft ?? saved ?? []

  if (error !== null) {
    return <p className='text-sm text-error'>{error.message}</p>
  }
  if (saved === undefined) {
    return <Skeleton className='h-40 w-full' />
  }

  const dirty = draft !== null && !sameOrder(draft, saved)

  // The keyboard stays on the song it moved (on its other arrow at an end), or after a removal goes to the
  // row that took the removed one's place
  const refocus = (videoId: string | undefined, action: Action) => {
    const row = list.current?.querySelector(`[data-video-id="${videoId}"]`)
    const button =
      row?.querySelector<HTMLButtonElement>(
        `[data-action="${action}"]:not(:disabled)`
      ) ?? row?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    button?.focus()
  }

  const act = (index: number, action: Action) => {
    const song = songs[index]
    const next = songs.toSpliced(index, 1)
    if (action === 'remove') {
      flushSync(() => {
        setDraft(next)
      })
      refocus(next[Math.min(index, next.length - 1)]?.videoId, action)
      setAnnouncement(`Removed ${song.title}.`)
      return
    }
    const to = action === 'up' ? index - 1 : index + 1
    flushSync(() => {
      setDraft(next.toSpliced(to, 0, song))
    })
    refocus(song.videoId, action)
    setAnnouncement(
      `Moved ${song.title} to position ${to + 1} of ${songs.length}.`
    )
  }

  return (
    <div className='flex flex-col gap-4'>
      <AddSong
        songs={songs}
        onAdd={(song) => {
          setDraft([...songs, song])
          setAnnouncement(`Added ${song.title}.`)
        }}
      />
      {songs.length === 0 ? (
        <p className='py-6 text-center text-sm text-muted-foreground'>
          The list is empty. Add at least one song to save it.
        </p>
      ) : (
        <ol ref={list} className='flex flex-col'>
          {songs.map((song, index) => (
            <Row
              key={song.videoId}
              song={song}
              index={index}
              count={songs.length}
              onAction={(action) => {
                act(index, action)
              }}
            />
          ))}
        </ol>
      )}
      <div className='flex flex-wrap items-center gap-3 border-t border-border pt-4'>
        <span className='text-sm text-muted-foreground tabular-nums'>
          {songs.length === 1 ? '1 song' : `${songs.length} songs`}
          {dirty && ' · Unsaved Changes'}
        </span>
        <div className='flex w-full gap-2 sm:ml-auto sm:w-auto'>
          <Button
            variant='outline'
            className='flex-1 sm:flex-none'
            disabled={!dirty || saving}
            onClick={() => {
              setDraft(null)
              setAnnouncement('Changes discarded.')
            }}>
            Discard
          </Button>
          <Button
            className='flex-1 sm:flex-none'
            disabled={!dirty || saving || songs.length === 0}
            onClick={() => {
              save(songs, {
                onError: () => {
                  toast({
                    description: 'The list is unchanged. Try again.',
                    title: 'Could Not Save Recommendations',
                    variant: 'destructive',
                  })
                },
                onSuccess: () => {
                  setDraft(null)
                  toast({
                    description: 'Visitors see the new list within a minute.',
                    title: 'Recommendations Saved',
                  })
                },
              })
            }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>
      <output className='sr-only'>{announcement}</output>
    </div>
  )
}
