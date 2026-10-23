import { atom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { atomWithStorage, createJSONStorage } from 'jotai/utils'
import { useNavigate } from 'react-router'

import { ToastAction } from '@/components/ui/toast'
import { useToast } from '@/components/ui/use-toast'
import { playlistsAtom, recordLibraryAtom } from '@/lib/library/store'
import { syncedStorage } from '@/lib/prefs/storage'

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

// The queue and autoplay live on this device; playlists follow the account (lib/library)
export const queueAtom = atomWithStorage<ListSong[]>('listeningQueue', [])
export const queueSourceAtom = atomWithStorage<QueueSource>(
  'listeningSource',
  null
)
export const autoplayAtom = atomWithStorage(
  'listeningAutoplay',
  true,
  syncedStorage(),
  { getOnInit: true }
)
// The song opened last in this visit, for the installed app's bar that takes you back to it
export const resumeSongAtom = atom<ListSong | null>(null)
// The songs played before it in this visit, the latest last, for Previous (model › leftSong). Kept for the tab's
// life, so an update's reload doesn't lose the way back
export const playedAtom = atomWithStorage<ListSong[]>(
  'listeningPlayed',
  [],
  createJSONStorage(() => sessionStorage),
  { getOnInit: true }
)

export const songPath = (videoId: string) => `/v/${videoId}`

// Every way the app changes the queue or the playlists, each with the same short confirmation
export const useListening = () => {
  const store = useStore()
  const setQueue = useSetAtom(queueAtom)
  const setSource = useSetAtom(queueSourceAtom)
  const record = useSetAtom(recordLibraryAtom)
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
  // A short toast with Undo, for changes that drop songs
  const undoable = (title: string, description: string, undo: () => void) => {
    toast({
      action: (
        <ToastAction altText={`Undo: ${title}`} onClick={undo}>
          Undo
        </ToastAction>
      ),
      description,
      duration: 5000,
      title,
    })
  }

  const removeFromQueue = (videoId: string) => {
    const before = store.get(queueAtom)
    const song = before.find((queued) => queued.videoId === videoId)
    setQueue(removeSong(before, videoId))
    if (song !== undefined) {
      undoable('Removed from Queue', song.title, () => {
        setQueue(before)
      })
    }
  }
  const moveInQueue = (from: number, to: number) => {
    setQueue((queue) => move(queue, from, to))
  }
  const clearQueue = () => {
    const before = store.get(queueAtom)
    const source = store.get(queueSourceAtom)
    setQueue([])
    setSource(null)
    undoable(
      'Queue Cleared',
      before.length === 1 ? '1 song' : `${before.length} songs`,
      () => {
        setQueue(before)
        setSource(source)
      }
    )
  }

  // Every change, an undo included, is newer than the last, so the account keeps it
  const updatePlaylist = (id: string, change: (list: Playlist) => Playlist) => {
    const list = store.get(playlistsAtom).find((saved) => saved.id === id)
    if (list !== undefined) {
      record({
        kind: 'playlist',
        playlist: { ...change(list), updatedAt: Date.now() },
      })
    }
  }
  const createPlaylist = (name: string, songs: ListSong[] = []) => {
    const list = newPlaylist(name, songs, Date.now(), crypto.randomUUID())
    record({ kind: 'playlist', playlist: list })
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
    const list = store.get(playlistsAtom).find((saved) => saved.id === id)
    const song = list?.songs.find((saved) => saved.videoId === videoId)
    if (list === undefined || song === undefined) {
      return
    }
    updatePlaylist(id, (saved) => ({
      ...saved,
      songs: removeSong(saved.songs, videoId),
    }))
    undoable(`Removed from ${list.name}`, song.title, () => {
      updatePlaylist(id, (saved) => ({ ...saved, songs: list.songs }))
    })
  }
  const moveInPlaylist = (id: string, from: number, to: number) => {
    updatePlaylist(id, (list) => ({
      ...list,
      songs: move(list.songs, from, to),
    }))
  }
  const renamePlaylist = (id: string, name: string) => {
    if (name.trim() === '') {
      return
    }
    updatePlaylist(id, (list) => ({ ...list, name: name.trim() }))
  }
  const deletePlaylist = (id: string) => {
    const removed = store.get(playlistsAtom).find((list) => list.id === id)
    if (removed === undefined) {
      return
    }
    record({ at: Date.now(), id, kind: 'deletePlaylist' })
    toast({
      action: (
        <ToastAction
          altText='Undo delete'
          onClick={() => {
            record({
              kind: 'playlist',
              playlist: { ...removed, updatedAt: Date.now() },
            })
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
