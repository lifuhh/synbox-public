import {
  CheckIcon,
  ListPlusIcon,
  PlusIcon,
  ShieldIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
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
  LAST_RECOMMENDATION,
  RecommendationsFullError,
  useAddRecommendation,
  useAdminRecommendations,
  useRemoveRecommendation,
} from '@/lib/admin'
import { useAccess } from '@/lib/auth'
import type { ListSong } from '@/lib/listening/model'
import { useListening, usePlaylists } from '@/lib/listening/store'
import { toRecommendation } from '@/lib/recommendations'

const ROW =
  'group/row flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-start transition-colors hover:bg-accent aria-disabled:cursor-default aria-disabled:hover:bg-transparent'

// A row's leading icon: a tick when the song is in the list, which turns to an X under the pointer, as a tap
// takes it out
const Mark = ({ saved, idle }: { saved: boolean; idle: ReactNode }) => (
  <span className='grid size-5 shrink-0 place-items-center text-muted-foreground'>
    {saved ? (
      <>
        <CheckIcon className='size-5 text-primary-text group-hover/row:hidden' />
        <XIcon className='hidden size-5 text-foreground group-hover/row:block' />
      </>
    ) : (
      idle
    )}
  </span>
)

// For admins: the landing page's Recommendations as one more list, marked admin only. A tap adds the song to
// the end, or takes it out when it is in
const RecommendedRow = ({
  song,
  onDone,
}: {
  song: ListSong
  onDone: () => void
}) => {
  const { data: songs } = useAdminRecommendations()
  const add = useAddRecommendation()
  const remove = useRemoveRecommendation()
  const saved = songs?.some((item) => item.videoId === song.videoId) ?? false
  const busy = songs === undefined || add.isPending || remove.isPending
  return (
    <li>
      <button
        type='button'
        aria-pressed={saved}
        aria-disabled={busy}
        onClick={() => {
          if (busy) {
            return
          }
          if (saved) {
            remove.mutate(song.videoId, {
              onError: (error) => {
                toast({
                  title:
                    error.message === LAST_RECOMMENDATION
                      ? 'Recommended Needs One Song'
                      : "Couldn't Remove from Recommended",
                  variant: 'destructive',
                })
              },
              onSuccess: () => {
                toast({
                  description: song.title,
                  duration: 2500,
                  title: 'Removed from Recommended',
                })
                onDone()
              },
            })
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
              onDone()
            },
          })
        }}
        className={ROW}>
        <Mark saved={saved} idle={<SparklesIcon className='size-5' />} />
        <span className='flex min-w-0 flex-1 items-center gap-1.5'>
          <span className='truncate'>Recommended</span>
          <ShieldIcon
            aria-hidden
            className='size-4 shrink-0 text-muted-foreground'
          />
          <span className='sr-only'>, Admin Only</span>
        </span>
        <span className='text-sm text-muted-foreground tabular-nums'>
          {songs?.length}
          <span className='sr-only'> songs</span>
        </span>
      </button>
    </li>
  )
}

// Every playlist with a tick on those that have the song; a tap adds it, or takes it out when ticked. A new
// playlist starts with the song
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
  const { addToPlaylist, createPlaylist, removeFromPlaylist } = useListening()
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
                onDone={() => {
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
                    aria-pressed={saved}
                    onClick={() => {
                      if (saved) {
                        removeFromPlaylist(list.id, song.videoId)
                      } else {
                        addToPlaylist(list.id, song)
                      }
                      onOpenChange(false)
                    }}
                    className={ROW}>
                    <Mark
                      saved={saved}
                      idle={<ListPlusIcon className='size-5' />}
                    />
                    <span className='min-w-0 flex-1 truncate'>{list.name}</span>
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
              placeholder='New Playlist'
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
