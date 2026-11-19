import {
  ArrowUpDownIcon,
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
import { cn } from '@/utils/cn'

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

// One playlist: play it from the top or from any song, drag songs into order (on touch, after Reorder Songs), rename
// or delete it
const PlaylistPage = () => {
  const [box, setBox] = useState<HTMLElement | null>(null)
  const { playlistId = '' } = useParams<{ playlistId: string }>()
  const navigate = useNavigate()
  const playlist = usePlaylists().find((list) => list.id === playlistId)
  const { deletePlaylist, moveInPlaylist, playPlaylist, startPlaylistAt } =
    useListening()
  const [renaming, setRenaming] = useState(false)
  // Touch only: the rows' grips show (a mouse always has them)
  const [reordering, setReordering] = useState(false)

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
            {/* The label's 20px line in a 44px press area; the negative margins keep the spacing the line had */}
            <Link
              to='/playlists'
              className='-mt-3 -mb-6 flex min-h-11 w-fit label-icons items-center gap-1 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground'>
              <ChevronLeftIcon className='size-4' aria-hidden />
              All Playlists
            </Link>
            {/* The cover beside the name; the actions under both on a phone, under the name from sm. One height and
                one shape for all three: 40px, 44px on touch, round */}
            <header className='grid grid-cols-[auto_minmax(0,1fr)] items-end gap-4 sm:grid-rows-[1fr_auto]'>
              <PlaylistCover
                playlist={playlist}
                className='size-28 sm:row-span-2 sm:size-40 short:size-20'
              />
              <div className='min-w-0'>
                <h1 className='line-clamp-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl'>
                  {playlist.name}
                </h1>
                <p className='text-sm text-muted-foreground'>
                  {songCount(playlist.songs.length)}
                </p>
              </div>
              <div className='col-span-2 flex items-center gap-2 sm:col-span-1'>
                {reordering ? (
                  // While the grips show on touch, the one way back takes Play's place
                  <Button
                    variant='hero'
                    size='inset'
                    className='flex-1 sm:flex-none touch:h-11'
                    onClick={() => {
                      setReordering(false)
                    }}>
                    <span className='text-label'>Done</span>
                  </Button>
                ) : (
                  <>
                    <Button
                      variant='hero'
                      size='inset'
                      gap='sm'
                      className='flex-1 sm:flex-none touch:h-11'
                      disabled={playlist.songs.length === 0}
                      onClick={() => {
                        playPlaylist(playlist.id)
                      }}>
                      <PlayIcon className='size-5 fill-current' aria-hidden />
                      <span className='text-label'>Play</span>
                    </Button>
                    <Button
                      variant='outline-round'
                      size='inset'
                      gap='sm'
                      className='flex-1 sm:flex-none touch:h-11'
                      disabled={playlist.songs.length === 0}
                      onClick={() => {
                        playPlaylist(playlist.id, true)
                      }}>
                      <ShuffleIcon className='size-5' aria-hidden />
                      <span className='text-label'>Shuffle</span>
                    </Button>
                  </>
                )}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='outline-round'
                      size='icon'
                      className='shrink-0 touch:size-11'
                      aria-label='Playlist Actions'>
                      <EllipsisIcon className='size-5' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-48'>
                    {playlist.songs.length > 1 && (
                      <DropdownMenuItem
                        className='mouse:hidden'
                        disabled={reordering}
                        onSelect={() => {
                          setReordering(true)
                        }}>
                        <ArrowUpDownIcon className='mr-2 size-5 shrink-0' />
                        Reorder Songs
                      </DropdownMenuItem>
                    )}
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
            </header>
            {playlist.songs.length === 0 ? (
              <p className='py-8 text-center text-sm text-pretty text-muted-foreground'>
                Save songs here from their menu
              </p>
            ) : (
              // The rows' 8px padding hangs into the gutter so the thumbnails start on the cover's edge; with a mouse
              // on a wide page the grip hangs there too. On touch the grip shows only while reordering, so it never
              // takes a phone row's width; each row's menu has Move Up and Move Down besides
              <SortableList
                className='-mx-2 mouse:md:-ms-11'
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
                    lead={
                      <span
                        className={cn(
                          'contents',
                          !reordering && 'touch:hidden'
                        )}>
                        {grip}
                      </span>
                    }
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
