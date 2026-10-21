import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { useNavigate } from 'react-router'

import { ToastAction } from '@/components/ui/toast'
import { useToast } from '@/components/ui/use-toast'

import type { ListSong, Playlist, QueueSource } from './model'
import {
  addToPlaylist as addSongToPlaylist,
  addToQueue as addSongToQueue,
  move,
  newPlaylist,
  playFrom,
  playNext as playSongNext,
  removeSong,
} from './model'

// The queue, the playlists and autoplay live on this device, as bookmarks and history do
export const queueAtom = atomWithStorage<ListSong[]>('listeningQueue', [])
export const queueSourceAtom = atomWithStorage<QueueSource>(
  'listeningSource',
  null
)
export const autoplayAtom = atomWithStorage('listeningAutoplay', true)
export const playlistsAtom = atomWithStorage<Playlist[]>('playlists', [])

export const songPath = (videoId: string) => `/v/${videoId}`

// Every way the app changes the queue or the playlists, each with the same short confirmation
export const useListening = () => {
  const store = useStore()
  const setQueue = useSetAtom(queueAtom)
  const setSource = useSetAtom(queueSourceAtom)
  const setPlaylists = useSetAtom(playlistsAtom)
  const navigate = useNavigate()
  const { toast } = useToast()

  const playNext = (song: ListSong) => {
    setQueue((queue) => playSongNext(queue, song))
    toast({ description: song.title, duration: 2500, title: 'Playing Next' })
  }
  const addToQueue = (song: ListSong) => {
    setQueue((queue) => addSongToQueue(queue, song))
    toast({ description: song.title, duration: 2500, title: 'Added to Queue' })
  }
  const removeFromQueue = (videoId: string) => {
    setQueue((queue) => removeSong(queue, videoId))
  }
  const moveInQueue = (from: number, to: number) => {
    setQueue((queue) => move(queue, from, to))
  }
  const clearQueue = () => {
    setQueue([])
    setSource(null)
  }

  const updatePlaylist = (id: string, change: (list: Playlist) => Playlist) => {
    setPlaylists((lists) =>
      lists.map((list) => (list.id === id ? change(list) : list))
    )
  }
  const createPlaylist = (name: string, songs: ListSong[] = []) => {
    const list = newPlaylist(name, songs, Date.now(), crypto.randomUUID())
    setPlaylists((lists) => [list, ...lists])
    return list
  }
  const addToPlaylist = (id: string, song: ListSong) => {
    const list = store.get(playlistsAtom).find((saved) => saved.id === id)
    if (list === undefined) {
      return
    }
    updatePlaylist(id, (saved) => addSongToPlaylist(saved, song, Date.now()))
    toast({
      description: song.title,
      duration: 2500,
      title: `Saved to ${list.name}`,
    })
  }
  const removeFromPlaylist = (id: string, videoId: string) => {
    updatePlaylist(id, (list) => ({
      ...list,
      songs: removeSong(list.songs, videoId),
      updatedAt: Date.now(),
    }))
  }
  const moveInPlaylist = (id: string, from: number, to: number) => {
    updatePlaylist(id, (list) => ({
      ...list,
      songs: move(list.songs, from, to),
      updatedAt: Date.now(),
    }))
  }
  const renamePlaylist = (id: string, name: string) => {
    if (name.trim() === '') {
      return
    }
    updatePlaylist(id, (list) => ({
      ...list,
      name: name.trim(),
      updatedAt: Date.now(),
    }))
  }
  const deletePlaylist = (id: string) => {
    const lists = store.get(playlistsAtom)
    const index = lists.findIndex((list) => list.id === id)
    if (index === -1) {
      return
    }
    const removed = lists[index]
    setPlaylists(lists.filter((list) => list.id !== id))
    toast({
      action: (
        <ToastAction
          altText='Undo delete'
          onClick={() => {
            setPlaylists((current) => [
              ...current.slice(0, index),
              removed,
              ...current.slice(index),
            ])
          }}>
          Undo
        </ToastAction>
      ),
      description: removed.name,
      duration: 5000,
      title: 'Playlist Deleted',
    })
  }

  // Lines a playlist up from one of its songs: the songs after it become the queue. For a link that opens
  // that song itself
  const queuePlaylistFrom = (id: string, index: number) => {
    const list = store.get(playlistsAtom).find((saved) => saved.id === id)
    if (list === undefined || index >= list.songs.length) {
      return null
    }
    const play = playFrom(list, index)
    setQueue(play.queue)
    setSource(play.source)
    return play.song
  }
  // Plays a playlist from one of its songs
  const playPlaylist = (id: string, index = 0) => {
    const song = queuePlaylistFrom(id, index)
    if (song !== null) {
      void navigate(songPath(song.videoId), {
        state: { videoId: song.videoId },
      })
    }
  }

  return {
    addToPlaylist,
    addToQueue,
    clearQueue,
    createPlaylist,
    deletePlaylist,
    moveInPlaylist,
    moveInQueue,
    playNext,
    playPlaylist,
    queuePlaylistFrom,
    removeFromPlaylist,
    removeFromQueue,
    renamePlaylist,
  }
}

export const usePlaylists = () => useAtomValue(playlistsAtom)
