import {
  EllipsisIcon,
  ListEndIcon,
  ListPlusIcon,
  ListStartIcon,
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

import { SaveToPlaylist } from './save-to-playlist'

// A song's more-actions menu: Play Next, Add to Queue, Save to Playlist
export const SongMenu = ({ song }: { song: ListSong }) => {
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
            aria-label={`More Actions for ${song.title}`}>
            <EllipsisIcon className='size-5' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-52'>
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
