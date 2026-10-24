import { useAtomValue } from 'jotai'
import { ArrowUpRightIcon } from 'lucide-react'

import { YouTubeIcon } from '@/components/svgicons'
import { stageClockAtom } from '@/context/atoms'
import { useGetSongInfoBySongId } from '@/lib/react-query/queries-and-mutations'
import { listensText, useSongStats } from '@/lib/song-stats'

const ADDED = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
})

// Under the song's title and channel, as YouTube's description box without the description: how often it was
// played, when it came to Synbox, and the way to the video on YouTube
export const SongFacts = ({ videoId }: { videoId: string }) => {
  const { data: stats, isPending } = useSongStats(videoId)
  const { data: info } = useGetSongInfoBySongId(videoId)
  const clock = useAtomValue(stageClockAtom)
  const addedAt = info?.addedAt === undefined ? null : new Date(info.addedAt)
  const added =
    addedAt !== null && !Number.isNaN(addedAt.getTime())
      ? `Added ${ADDED.format(addedAt)}`
      : null
  return (
    <div className='flex min-h-14 items-center justify-between gap-3 rounded-xl bg-card py-2 pr-2 pl-4'>
      {/* A blank until the count settles, so the line never jumps; without a count, the date alone */}
      <p className='min-w-0 text-sm font-semibold text-pretty text-foreground tabular-nums'>
        {/* The count stays with its word; a narrow card breaks at the dot */}
        <span className='whitespace-nowrap'>
          {isPending ? '\u00A0' : stats && listensText(stats.listens)}
        </span>
        {!isPending && added !== null && (
          <span className='font-normal whitespace-nowrap text-muted-foreground'>
            {stats ? ` · ${added}` : added}
          </span>
        )}
      </p>
      <a
        href={`https://www.youtube.com/watch?v=${videoId}`}
        target='_blank'
        rel='noreferrer'
        aria-label='Open on YouTube'
        // The song here stops while it plays there
        onClick={() => {
          clock?.pause()
        }}
        className='flex h-10 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'>
        <YouTubeIcon aria-hidden className='h-3.5 w-auto shrink-0' />
        YouTube
        <ArrowUpRightIcon
          aria-hidden
          className='size-4 shrink-0 text-muted-foreground'
        />
      </a>
    </div>
  )
}
