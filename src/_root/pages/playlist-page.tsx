import {
  EllipsisIcon,
  ListEndIcon,
  ListStartIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

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
import { PlaylistCover } from '@/components/watch/playlist-cover'
import { SongRow } from '@/components/watch/song-row'
import { SortableList } from '@/components/watch/sortable-list'
import type { ListSong, Playlist } from '@/lib/listening/model'
import { useListening, usePlaylists } from '@/lib/listening/store'

// A song's menu inside a playlist: queue it, or take it out of the playlist
const PlaylistSongMenu = ({
  playlist,
  song,
}: {
  playlist: Playlist
  song: ListSong
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
          <Button type='submit' disabled={name.trim() === ''}>
            Save
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const songCount = (count: number) => (count === 1 ? '1 song' : `${count} songs`)

// One playlist: play it from the top or from any song, drag songs into order, rename or delete it
const PlaylistPage = () => {
  const { playlistId = '' } = useParams<{ playlistId: string }>()
  const navigate = useNavigate()
  const playlist = usePlaylists().find((list) => list.id === playlistId)
  const { deletePlaylist, moveInPlaylist, playPlaylist, queuePlaylistFrom } =
    useListening()
  const [renaming, setRenaming] = useState(false)

  return (
    <section
      data-scroll-top
      className='flex flex-1 flex-col overflow-y-auto px-4 pt-(--topbar-h) pb-page-bottom md:px-10'>
      <title>{`${playlist?.name ?? 'Playlist'} | Synbox`}</title>
      <div className='mx-auto flex w-full max-w-3xl flex-col gap-6 pt-6'>
        {playlist === undefined ? (
          <div className='flex flex-col items-center gap-3 py-16 text-center'>
            <p className='text-lg font-medium text-foreground'>
              This playlist isn&apos;t on this device
            </p>
            <Button asChild variant='outline'>
              <Link to='/playlists'>All Playlists</Link>
            </Button>
          </div>
        ) : (
          <>
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
                renderItem={(song, grip, index) => (
                  <SongRow
                    as='div'
                    song={song}
                    lead={grip}
                    onOpen={() => {
                      queuePlaylistFrom(playlist.id, index)
                    }}
                    actions={
                      <PlaylistSongMenu playlist={playlist} song={song} />
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
    </section>
  )
}

export default PlaylistPage
