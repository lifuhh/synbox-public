import { PlayIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { BoxScrollbar } from '@/components/shared/doc-scroll'
import { Button } from '@/components/ui/button'
import { Input, InputField } from '@/components/ui/input'
import { PlaylistCover } from '@/components/watch/playlist-cover'
import { useListening, usePlaylists } from '@/lib/listening/store'

const songCount = (count: number) => (count === 1 ? '1 song' : `${count} songs`)

// The listener's playlists on this device: make one, open one, or play one straight away
const PlaylistsPage = () => {
  const [box, setBox] = useState<HTMLElement | null>(null)
  const playlists = usePlaylists()
  const { createPlaylist, playPlaylist } = useListening()
  const [name, setName] = useState('')

  return (
    <section
      ref={setBox}
      data-scroll-top
      className='flex flex-1 flex-col overflow-y-auto pt-(--topbar-h) page-x pb-page-bottom'>
      <title>Playlists | Synbox</title>
      <div className='mx-auto flex w-full max-w-3xl flex-col gap-6 pt-6'>
        <h1 className='text-3xl font-semibold tracking-tight text-foreground'>
          Playlists
        </h1>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            createPlaylist(name)
            setName('')
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
            <Button type='submit' variant='hero' size='inset' gap='sm'>
              <PlusIcon className='size-5' aria-hidden />
              <span className='text-label'>New Playlist</span>
            </Button>
          </InputField>
        </form>
        {playlists.length === 0 ? (
          <div className='flex flex-col items-center gap-2 py-12 text-center'>
            <p className='text-lg font-medium text-foreground'>
              No playlists yet
            </p>
            <p className='max-w-sm text-sm text-pretty text-muted-foreground'>
              Name one above, or save a song to a new playlist from its menu or
              the player&apos;s Save to Playlist button.
            </p>
          </div>
        ) : (
          <ul className='flex flex-col gap-1'>
            {playlists.map((list) => (
              <li
                key={list.id}
                className='flex items-center gap-1 rounded-xl transition-colors has-[a:hover]:bg-accent'>
                <Link
                  to={`/playlists/${list.id}`}
                  className='flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
                  <PlaylistCover playlist={list} className='size-16' />
                  <span className='flex min-w-0 flex-col'>
                    <span className='truncate font-medium text-foreground'>
                      {list.name}
                    </span>
                    <span className='text-sm text-muted-foreground'>
                      {songCount(list.songs.length)}
                    </span>
                  </span>
                </Link>
                {list.songs.length > 0 && (
                  <Button
                    variant='row-icon'
                    size='icon'
                    className='me-2'
                    aria-label={`Play ${list.name}`}
                    onClick={() => {
                      playPlaylist(list.id)
                    }}>
                    <PlayIcon className='size-5 fill-current' />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <BoxScrollbar box={box} />
    </section>
  )
}

export default PlaylistsPage
