import { atom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { atomWithStorage, createJSONStorage } from 'jotai/utils'
import { useNavigate } from 'react-router'

import { ToastAction } from '@/components/ui/toast'
import { useToast } from '@/components/ui/use-toast'
import { playlistsAtom, recordLibraryAtom } from '@/lib/library/store'
import { syncedStorage } from '@/lib/prefs/storage'

import type { ListSong, PlayContext, Playlist } from './model'
import {
  addToPlaylist as addSongToPlaylist,
  addToQueue as addSongToQueue,
  move,
  newPlaylist,
  playNext as playSongNext,
  playPlaylist as startPlaylist,
  removeSong,
  reshuffle,
} from './model'
import { cryptoRandom } from './shuffle'

// The queue and autoplay live on this device; playlists follow the account (lib/library). Both lists are read
// on the first render: a change made before anything showed them (Add to Queue from the home page, the player
// following its song) would otherwise start from an empty list and save it over the stored one
export const queueAtom = atomWithStorage<ListSong[]>(
  'listeningQueue',
  [],
  undefined,
  { getOnInit: true }
)
// The playlist being played through, after the queue (model › PlayContext). Each tab plays its own: another
// tab opening a song must not end or move this one's
export const contextAtom = atomWithStorage<PlayContext | null>(
  'listeningContext',
  null,
  createJSONStorage(() => sessionStorage),
  { getOnInit: true }
)
// Where a playlist's songs once went into the queue, before the playlist being played had its own place
try {
  localStorage.removeItem('listeningSource')
} catch {
  // Storage blocked: nothing to tidy
}
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

// How a song was opened, carried in the navigation's state for the player page. By Previous (`back`): the song
// it left is not put on Previous's trail. By Previous or from the queue (`queued`): the playlist being played
// waits (model › followSong). Any other way of opening a song that isn't in the playlist ends it
export type OpenedBy = 'back' | 'queued'
export const songState = (videoId: string, by?: OpenedBy) => ({ by, videoId })
export const openedBy = (state: unknown): OpenedBy | undefined =>
  typeof state === 'object' &&
  state !== null &&
  'by' in state &&
  (state.by === 'back' || state.by === 'queued')
    ? state.by
    : undefined

// Every way the app changes the queue or the playlists, each with the same short confirmation
export const useListening = () => {
  const store = useStore()
  const setQueue = useSetAtom(queueAtom)
  const setContext = useSetAtom(contextAtom)
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
    setQueue([])
    undoable(
      'Queue Cleared',
      before.length === 1 ? '1 song' : `${before.length} songs`,
      () => {
        setQueue(before)
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

  // Starts playing a playlist, in order from one of its songs or shuffled, and returns the song to open; for a
  // link that opens that song itself. The queue stays as it is and plays first
  const startPlaylistAt = (
    id: string,
    play: { from?: number; shuffled: boolean }
  ) => {
    const list = store.get(playlistsAtom).find((saved) => saved.id === id)
    if (list === undefined || list.songs.length === 0) {
      return null
    }
    const context = startPlaylist(list, play, cryptoRandom)
    setContext(context)
    return context.order[context.at] ?? null
  }
  const playPlaylist = (id: string, shuffled = false) => {
    const song = startPlaylistAt(id, { shuffled })
    if (song !== null) {
      void navigate(songPath(song.videoId), {
        state: songState(song.videoId),
      })
    }
  }
  // Shuffle on or off for the playlist playing: its songs already played stay, the rest are reordered
  const setShuffled = (shuffled: boolean) => {
    const context = store.get(contextAtom)
    const list = store
      .get(playlistsAtom)
      .find((saved) => saved.id === context?.id)
    if (context !== null) {
      // A playlist deleted while it plays still shuffles what it had
      setContext(
        reshuffle(context, list?.songs ?? context.order, shuffled, cryptoRandom)
      )
    }
  }
  // Stops playing the playlist: the song plays on, then the queue and recommendations
  const leavePlaylist = () => {
    setContext(null)
  }

  return {
    addToPlaylist,
    addToQueue,
    clearQueue,
    createPlaylist,
    deletePlaylist,
    leavePlaylist,
    moveInPlaylist,
    moveInQueue,
    playNext,
    playPlaylist,
    removeFromPlaylist,
    removeFromQueue,
    renamePlaylist,
    setShuffled,
    startPlaylistAt,
  }
}

export const usePlaylists = () => useAtomValue(playlistsAtom)
