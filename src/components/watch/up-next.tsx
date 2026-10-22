import { useAtom, useAtomValue } from 'jotai'
import { EllipsisIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ListSong } from '@/lib/listening/model'
import { filterKey, filterLabel } from '@/lib/listening/next-filter'
import { useNextList } from '@/lib/listening/recommendations'
import {
  autoplayAtom,
  queueAtom,
  queueSourceAtom,
  useListening,
} from '@/lib/listening/store'
import { cn } from '@/utils/cn'

import { MoveItems } from './move-items'
import { SongMenu } from './song-menu'
import { SongRow } from './song-row'
import { SortableList } from './sortable-list'
import { Switch } from './switch'

// How many songs the list beside the video shows; More Like This has the rest
export const UP_NEXT_COUNT = 20

// What plays after this song: the listener's queue first (drag to reorder, × to remove), then the list, which
// chips narrow to the song's artist, mood or kind of singer, as YouTube's do. Autoplay plays the top of the
// list as filtered. Each song has Play Next, Add to Queue and Save to Playlist
// A queued song's menu: move it without dragging, or take it out of the queue
const QueueRowMenu = ({
  song,
  index,
  count,
  moveTo,
}: {
  song: ListSong
  index: number
  count: number
  moveTo: (to: number) => void
}) => {
  const { removeFromQueue } = useListening()
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant='row-icon'
          size='icon'
          aria-label={`More Actions for ${song.title}`}>
          <EllipsisIcon className='size-5' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-52'>
        <MoveItems index={index} count={count} moveTo={moveTo} />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant='destructive'
          onSelect={() => {
            removeFromQueue(song.videoId)
          }}>
          <XIcon className='mr-2 size-5 shrink-0' />
          Remove from Queue
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const UpNext = ({
  videoId,
  autoplaySwitch,
  large = false,
  className,
}: {
  videoId: string
  // Phones have no room for it in the video's control bar, so it heads the list there
  autoplaySwitch: boolean
  // Big rows, as in YouTube's right-hand column
  large?: boolean
  className?: string
}) => {
  const queue = useAtomValue(queueAtom)
  const source = useAtomValue(queueSourceAtom)
  const [autoplay, setAutoplay] = useAtom(autoplayAtom)
  const { clearQueue, moveInQueue } = useListening()
  const { filter, filters, setFilter, songs } = useNextList(videoId)
  const queued = new Set(queue.map((song) => song.videoId))
  const suggestions = songs
    .filter((song) => !queued.has(song.videoId))
    .slice(0, UP_NEXT_COUNT)

  return (
    <section aria-label='Up Next' className={className}>
      {autoplaySwitch && (
        <div className='flex min-h-11 items-center justify-end text-sm text-muted-foreground'>
          <label htmlFor='autoplay-switch' className='cursor-pointer'>
            Autoplay
          </label>
          <Switch
            id='autoplay-switch'
            checked={autoplay}
            onCheckedChange={setAutoplay}
          />
        </div>
      )}

      {queue.length > 0 && (
        <div className='mt-1 mb-3'>
          <div className='flex min-h-9 items-center justify-between gap-2 ps-2'>
            <p className='min-w-0 truncate text-sm text-muted-foreground'>
              {source === null
                ? 'Next in Queue'
                : `Playing From ${source.name}`}
            </p>
            <Button variant='ghost-subtle' size='sm' onClick={clearQueue}>
              Clear Queue
            </Button>
          </div>
          <SortableList
            items={queue}
            keyOf={(song) => song.videoId}
            labelOf={(song) => song.title}
            onMove={moveInQueue}
            renderItem={(song, grip, index, moveTo) => (
              <SongRow
                as='div'
                song={song}
                large={large}
                lead={grip}
                actions={
                  <QueueRowMenu
                    song={song}
                    index={index}
                    count={queue.length}
                    moveTo={moveTo}
                  />
                }
              />
            )}
          />
        </div>
      )}

      {filters.length > 1 && (
        <fieldset className='flex min-w-0 flex-wrap gap-2 pb-2'>
          <legend className='sr-only'>Show Songs</legend>
          {filters.map((option) => {
            const on = filterKey(option) === filterKey(filter)
            return (
              <button
                key={filterKey(option)}
                type='button'
                aria-pressed={on}
                onClick={() => {
                  setFilter(option)
                }}
                className={cn(
                  'h-8 max-w-full truncate rounded-lg px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden',
                  on
                    ? 'bg-foreground text-background'
                    : 'bg-card text-foreground hover:bg-accent'
                )}>
                {filterLabel(option)}
              </button>
            )
          })}
        </fieldset>
      )}

      {suggestions.length > 0 && (
        <>
          {queue.length > 0 && (
            <p className='flex min-h-9 items-center ps-2 text-sm text-muted-foreground'>
              {autoplay ? 'Then' : 'Suggested'}
            </p>
          )}
          <ul className='flex flex-col'>
            {suggestions.map((song) => (
              <SongRow
                key={song.videoId}
                song={song}
                large={large}
                // Under a queue, the grip's width keeps every thumbnail on one edge
                lead={
                  queue.length > 0 ? (
                    <span aria-hidden className='w-8 shrink-0' />
                  ) : undefined
                }
                actions={<SongMenu song={song} />}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
