import { useAtom, useAtomValue } from 'jotai'
import { XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { ListSong } from '@/lib/listening/model'
import {
  autoplayAtom,
  queueAtom,
  queueSourceAtom,
  useListening,
} from '@/lib/listening/store'

import { SongMenu } from './song-menu'
import { SongRow } from './song-row'
import { SortableList } from './sortable-list'
import { Switch } from './switch'

// How many recommendations Up Next shows; the rest are More Like This
export const UP_NEXT_COUNT = 5

// What plays after this song: the listener's queue first (drag to reorder, × to remove), then, with autoplay
// on, the recommendations, each with Play Next, Add to Queue and Save to Playlist
export const UpNext = ({
  recommendations,
  className,
}: {
  recommendations: ListSong[]
  className?: string
}) => {
  const queue = useAtomValue(queueAtom)
  const source = useAtomValue(queueSourceAtom)
  const [autoplay, setAutoplay] = useAtom(autoplayAtom)
  const { clearQueue, moveInQueue, removeFromQueue } = useListening()
  const queued = new Set(queue.map((song) => song.videoId))
  const suggestions = recommendations
    .filter((song) => !queued.has(song.videoId))
    .slice(0, UP_NEXT_COUNT)

  return (
    <section aria-labelledby='up-next-title' className={className}>
      <div className='flex min-h-11 items-center justify-between gap-2 ps-2'>
        <h2 id='up-next-title' className='text-base font-semibold'>
          Up Next
        </h2>
        <div className='flex items-center text-sm text-muted-foreground'>
          <span aria-hidden>Autoplay</span>
          <Switch
            checked={autoplay}
            onCheckedChange={setAutoplay}
            label='Autoplay'
          />
        </div>
      </div>

      {queue.length > 0 && (
        <div className='mt-1 mb-3'>
          <div className='flex min-h-9 items-center justify-between gap-2 ps-2'>
            <p className='min-w-0 truncate text-sm text-muted-foreground'>
              {source === null
                ? 'Next in Queue'
                : `Playing From ${source.name}`}
            </p>
            <Button variant='ghost-subtle' size='sm' onClick={clearQueue}>
              Clear
            </Button>
          </div>
          <SortableList
            items={queue}
            keyOf={(song) => song.videoId}
            labelOf={(song) => song.title}
            onMove={moveInQueue}
            renderItem={(song, grip) => (
              <SongRow
                as='div'
                song={song}
                lead={grip}
                actions={
                  <Button
                    variant='row-icon'
                    size='icon'
                    aria-label={`Remove ${song.title} from Queue`}
                    onClick={() => {
                      removeFromQueue(song.videoId)
                    }}>
                    <XIcon className='size-5' />
                  </Button>
                }
              />
            )}
          />
        </div>
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
                actions={<SongMenu song={song} />}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
