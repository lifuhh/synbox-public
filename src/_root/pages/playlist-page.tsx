import {
  ChevronLeftIcon,
  EllipsisIcon,
  ListEndIcon,
  ListStartIcon,
  PencilIcon,
  PlayIcon,
  ShuffleIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { BoxScrollbar } from '@/components/shared/doc-scroll'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input, InputField } from '@/components/ui/input'
import { MoveItems } from '@/components/watch/move-items'
import { PlaylistCover } from '@/components/watch/playlist-cover'
import { SongRow } from '@/components/watch/song-row'
import { SortableList } from '@/components/watch/sortable-list'
import type { ListSong, Playlist } from '@/lib/listening/model'
import { useListening, usePlaylists } from '@/lib/listening/store'

// A song's menu inside a playlist: queue it, or take it out of the playlist
const PlaylistSongMenu = ({
  playlist,
  song,
  index,
  moveTo,
}: {
  playlist: Playlist
  song: ListSong
  index: number
  moveTo: (to: number) => void
}) => {
  const { addToQueue, playNext, removeFromPlaylist } = useListening()
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
      <DropdownMenuContent align='end' className='w-56'>
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
        <DropdownMenuSeparator />
        <MoveItems
          index={index}
          count={playlist.songs.length}
          moveTo={moveTo}
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant='destructive'
          onSelect={() => {
            removeFromPlaylist(playlist.id, song.videoId)
          }}>
          <XIcon className='mr-2 size-5 shrink-0' />
          Remove from Playlist
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const RenameDialog = ({
  playlist,
  open,
  onOpenChange,
}: {
  playlist: Playlist
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const { renamePlaylist } = useListening()
  const [name, setName] = useState(playlist.name)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>Rename Playlist</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            // An empty name keeps the old one
            renamePlaylist(playlist.id, name)
            onOpenChange(false)
          }}
          className='flex flex-col gap-4'>
          <InputField>
            <Input
              value={name}
              onChange={(event) => {
                setName(event.target.value)
              }}
              aria-label='Playlist Name'
              variant='bare'
            />
          </InputField>
          <Button type='submit'>Save</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const songCount = (count: number) => (count === 1 ? '1 song' : `${count} songs`)

// One playlist: play it from the top or from any song, drag songs into order, rename or delete it
const PlaylistPage = () => {
  const [box, setBox] = useState<HTMLElement | null>(null)
  const { playlistId = '' } = useParams<{ playlistId: string }>()
  const navigate = useNavigate()
  const playlist = usePlaylists().find((list) => list.id === playlistId)
  const { deletePlaylist, moveInPlaylist, playPlaylist, startPlaylistAt } =
    useListening()
  const [renaming, setRenaming] = useState(false)

  return (
    <section
      ref={setBox}
      data-scroll-top
      className='flex flex-1 flex-col overflow-y-auto pt-(--topbar-h) page-x pb-page-bottom'>
      <title>{`${playlist?.name ?? 'Playlist'} · Synbox`}</title>
      <div className='mx-auto flex w-full max-w-3xl flex-col gap-6 pt-6'>
        {playlist === undefined ? (
          <div className='flex flex-col items-center gap-3 py-16 text-center'>
            <p className='text-lg font-medium text-foreground'>
              Playlist Not on This Device
            </p>
            <Button asChild variant='outline'>
              <Link to='/playlists'>All Playlists</Link>
            </Button>
          </div>
        ) : (
          <>
            <Link
              to='/playlists'
              className='-mb-3 flex w-fit items-center gap-1 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
              <ChevronLeftIcon className='size-4' aria-hidden />
              All Playlists
            </Link>
            <header className='flex items-end gap-4'>
              <PlaylistCover
                playlist={playlist}
                className='size-28 sm:size-40'
              />
              <div className='flex min-w-0 flex-1 flex-col gap-3'>
                <div className='min-w-0'>
                  <h1 className='line-clamp-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl'>
                    {playlist.name}
                  </h1>
                  <p className='text-sm text-muted-foreground'>
                    {songCount(playlist.songs.length)}
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  <Button
                    variant='hero'
                    size='inset'
                    gap='sm'
                    disabled={playlist.songs.length === 0}
                    onClick={() => {
                      playPlaylist(playlist.id)
                    }}>
                    <PlayIcon className='size-5 fill-current' aria-hidden />
                    <span className='text-label'>Play</span>
                  </Button>
                  <Button
                    variant='outline'
                    size='inset'
                    gap='sm'
                    disabled={playlist.songs.length === 0}
                    onClick={() => {
                      playPlaylist(playlist.id, true)
                    }}>
                    <ShuffleIcon className='size-5' aria-hidden />
                    <span className='text-label'>Shuffle</span>
                  </Button>
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant='outline'
                        size='icon-round'
                        aria-label='Playlist Actions'>
                        <EllipsisIcon className='size-5' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='start' className='w-48'>
                      <DropdownMenuItem
                        onSelect={() => {
                          setRenaming(true)
                        }}>
                        <PencilIcon className='mr-2 size-5 shrink-0' />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant='destructive'
                        onSelect={() => {
                          deletePlaylist(playlist.id)
                          void navigate('/playlists', { replace: true })
                        }}>
                        <Trash2Icon className='mr-2 size-5 shrink-0' />
                        Delete Playlist
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </header>
            {playlist.songs.length === 0 ? (
              <p className='py-8 text-center text-sm text-pretty text-muted-foreground'>
                Save songs here from their menu, or from the player&apos;s Save
                to Playlist button.
              </p>
            ) : (
              <SortableList
                items={playlist.songs}
                keyOf={(song) => song.videoId}
                labelOf={(song) => song.title}
                onMove={(from, to) => {
                  moveInPlaylist(playlist.id, from, to)
                }}
                renderItem={(song, grip, index, moveTo) => (
                  <SongRow
                    as='div'
                    song={song}
                    lead={grip}
                    onOpen={() => {
                      startPlaylistAt(playlist.id, {
                        from: index,
                        shuffled: false,
                      })
                    }}
                    actions={
                      <PlaylistSongMenu
                        playlist={playlist}
                        song={song}
                        index={index}
                        moveTo={moveTo}
                      />
                    }
                  />
                )}
              />
            )}
            {renaming && (
              <RenameDialog
                playlist={playlist}
                open={renaming}
                onOpenChange={setRenaming}
              />
            )}
          </>
        )}
      </div>
      <BoxScrollbar box={box} />
    </section>
  )
}

export default PlaylistPage
