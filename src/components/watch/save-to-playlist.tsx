import { CheckIcon, ListPlusIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input, InputField } from '@/components/ui/input'
import type { ListSong } from '@/lib/listening/model'
import { useListening, usePlaylists } from '@/lib/listening/store'

// Every playlist with a tick on those that have the song; a tap adds it. A new playlist starts with the song
export const SaveToPlaylist = ({
  song,
  open,
  onOpenChange,
}: {
  song: ListSong
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const playlists = usePlaylists()
  const { addToPlaylist, createPlaylist } = useListening()
  const [name, setName] = useState('')

  const create = () => {
    createPlaylist(name, [song])
    setName('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>Save to Playlist</DialogTitle>
          <DialogDescription>
            <span className='line-clamp-1'>{song.title}</span>
          </DialogDescription>
        </DialogHeader>
        {playlists.length > 0 && (
          <ul className='-mx-2 flex max-h-72 flex-col overflow-y-auto overscroll-contain'>
            {playlists.map((list) => {
              const saved = list.songs.some(
                (item) => item.videoId === song.videoId
              )
              return (
                <li key={list.id}>
                  <button
                    type='button'
                    disabled={saved}
                    onClick={() => {
                      addToPlaylist(list.id, song)
                      onOpenChange(false)
                    }}
                    className='flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-start transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent'>
                    <span className='grid size-5 shrink-0 place-items-center text-muted-foreground'>
                      {saved ? (
                        <CheckIcon className='size-5 text-primary-text' />
                      ) : (
                        <ListPlusIcon className='size-5' />
                      )}
                    </span>
                    <span className='min-w-0 flex-1 truncate'>{list.name}</span>
                    <span className='text-sm text-muted-foreground tabular-nums'>
                      {list.songs.length}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            create()
          }}>
          <InputField>
            <Input
              value={name}
              onChange={(event) => {
                setName(event.target.value)
              }}
              aria-label='New Playlist Name'
              placeholder='New playlist name'
              variant='bare'
            />
            <Button
              type='submit'
              variant='hero'
              size='icon'
              aria-label='Create Playlist'>
              <PlusIcon className='size-5' />
            </Button>
          </InputField>
        </form>
      </DialogContent>
    </Dialog>
  )
}
