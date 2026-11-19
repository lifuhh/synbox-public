import {
  EllipsisIcon,
  ListEndIcon,
  ListPlusIcon,
  ListStartIcon,
  RadioIcon,
} from 'lucide-react'
import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ListSong } from '@/lib/listening/model'
import { useListening } from '@/lib/listening/store'
import { cn } from '@/utils/cn'

import { SaveToPlaylist } from './save-to-playlist'

// A song's more-actions menu: Play Next, Add to Queue, Save to Playlist, and More Like This where the page can show
// similar songs (Search). `className` places the trigger in its row
export const SongMenu = ({
  song,
  onMoreLikeThis,
  className,
}: {
  song: ListSong
  onMoreLikeThis?: () => void
  className?: string
}) => {
  const { addToQueue, playNext } = useListening()
  const [saving, setSaving] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            variant='row-icon'
            size='icon'
            className={cn('shrink-0', className)}
            aria-label={`More Actions for ${song.title}`}>
            <EllipsisIcon className='size-5' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-52'>
          {onMoreLikeThis !== undefined && (
            <DropdownMenuItem onSelect={onMoreLikeThis}>
              <RadioIcon className='mr-2 size-5 shrink-0' />
              More Like This
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => {
              playNext(song)
            }}>
            <ListStartIcon className='mr-2 size-5 shrink-0' />
            Play Next
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              addToQueue(song)
            }}>
            <ListEndIcon className='mr-2 size-5 shrink-0' />
            Add to Queue
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setSaving(true)
            }}>
            <ListPlusIcon className='mr-2 size-5 shrink-0' />
            Save to Playlist
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SaveToPlaylist
        song={song}
        open={saving}
        onOpenChange={setSaving}
        returnFocusRef={trigger}
      />
    </>
  )
}
