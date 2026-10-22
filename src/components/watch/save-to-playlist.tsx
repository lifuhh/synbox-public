import { CheckIcon, ListPlusIcon, PlusIcon, SparklesIcon } from 'lucide-react'
import type { RefObject } from 'react'
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
import { toast } from '@/components/ui/use-toast'
import {
  RecommendationsFullError,
  useAddRecommendation,
  useAdminRecommendations,
} from '@/lib/admin'
import { useAccess } from '@/lib/auth'
import type { ListSong } from '@/lib/listening/model'
import { useListening, usePlaylists } from '@/lib/listening/store'
import { toRecommendation } from '@/lib/recommendations'

const ROW =
  'flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-start transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden aria-disabled:cursor-default aria-disabled:hover:bg-transparent'

// For admins: the landing page's Recommendations as one more list, ticked when the song is in it. A tap adds it
// to the end; removing stays on the admin page, behind its confirm
const RecommendedRow = ({
  song,
  onAdded,
}: {
  song: ListSong
  onAdded: () => void
}) => {
  const { data: songs } = useAdminRecommendations()
  const add = useAddRecommendation()
  const saved = songs?.some((item) => item.videoId === song.videoId) ?? false
  return (
    <li>
      <button
        type='button'
        aria-disabled={saved || songs === undefined || add.isPending}
        onClick={() => {
          if (saved || songs === undefined || add.isPending) {
            return
          }
          add.mutate(toRecommendation(song), {
            onError: (error) => {
              toast({
                title:
                  error instanceof RecommendationsFullError
                    ? 'Recommended Is Full'
                    : "Couldn't Add to Recommended",
                variant: 'destructive',
              })
            },
            onSuccess: () => {
              toast({
                description: song.title,
                duration: 2500,
                title: 'Added to Recommended',
              })
              onAdded()
            },
          })
        }}
        className={ROW}>
        <span className='grid size-5 shrink-0 place-items-center text-muted-foreground'>
          {saved ? (
            <CheckIcon className='size-5 text-primary-text' />
          ) : (
            <SparklesIcon className='size-5' />
          )}
        </span>
        <span className='min-w-0 flex-1 truncate'>
          Recommended
          {saved && <span className='sr-only'>, Added</span>}
        </span>
        <span className='text-sm text-muted-foreground tabular-nums'>
          {songs?.length}
          <span className='sr-only'> songs</span>
        </span>
      </button>
    </li>
  )
}

// Every playlist with a tick on those that have the song; a tap adds it. A new playlist starts with the song
export const SaveToPlaylist = ({
  song,
  open,
  onOpenChange,
  returnFocusRef,
}: {
  song: ListSong
  open: boolean
  onOpenChange: (open: boolean) => void
  // What opened it (a menu's trigger, the rail's button), which gets the focus back on close
  returnFocusRef?: RefObject<HTMLElement | null>
}) => {
  const playlists = usePlaylists()
  const { admin } = useAccess()
  const { addToPlaylist, createPlaylist } = useListening()
  const [name, setName] = useState('')

  const create = () => {
    createPlaylist(name, [song])
    setName('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-w-sm'
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef?.current
          if (target) {
            event.preventDefault()
            target.focus()
          }
        }}>
        <DialogHeader>
          <DialogTitle>Save to Playlist</DialogTitle>
          <DialogDescription>
            <span className='line-clamp-1'>{song.title}</span>
          </DialogDescription>
        </DialogHeader>
        {(admin || playlists.length > 0) && (
          <ul className='-mx-2 flex max-h-72 flex-col overflow-y-auto overscroll-contain'>
            {admin && (
              <RecommendedRow
                song={song}
                onAdded={() => {
                  onOpenChange(false)
                }}
              />
            )}
            {playlists.map((list) => {
              const saved = list.songs.some(
                (item) => item.videoId === song.videoId
              )
              return (
                <li key={list.id}>
                  <button
                    type='button'
                    aria-disabled={saved}
                    onClick={() => {
                      if (saved) {
                        return
                      }
                      addToPlaylist(list.id, song)
                      onOpenChange(false)
                    }}
                    className={ROW}>
                    <span className='grid size-5 shrink-0 place-items-center text-muted-foreground'>
                      {saved ? (
                        <CheckIcon className='size-5 text-primary-text' />
                      ) : (
                        <ListPlusIcon className='size-5' />
                      )}
                    </span>
                    <span className='min-w-0 flex-1 truncate'>
                      {list.name}
                      {saved && <span className='sr-only'>, Saved</span>}
                    </span>
                    <span className='text-sm text-muted-foreground tabular-nums'>
                      {list.songs.length}
                      <span className='sr-only'> songs</span>
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
