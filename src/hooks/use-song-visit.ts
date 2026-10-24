import { useSetAtom } from 'jotai'
import { useEffect } from 'react'

import { currentVideoAtom } from '@/context/atoms'
import { addToHistoryAtom } from '@/lib/library/store'
import {
  useGetSongInfoBySongId,
  useGetYoutubeVideoInfo,
} from '@/lib/react-query/queries-and-mutations'
import type { CurrentPlayingInfo } from '@/types'

// Publishes the song being watched (currentVideoAtom: title, bookmarks) and records it in watch history, once
// the song is known to be in the library (`inLibrary`): a video that isn't leaves no trace. A song whose
// song_info row can't be read is named from YouTube's details; only the backend writes song_info
export const useSongVisit = (videoId: string, inLibrary: boolean) => {
  const setCurrentVideo = useSetAtom(currentVideoAtom)
  const addToHistory = useSetAtom(addToHistoryAtom)
  const {
    data: songInfo,
    isLoading: isLoadingSongInfo,
    isError: isSongInfoMissing,
  } = useGetSongInfoBySongId(videoId)
  const { data: youtubeInfo, isLoading: isLoadingYoutubeInfo } =
    useGetYoutubeVideoInfo(videoId)

  useEffect(() => {
    setCurrentVideo(null)
    return () => {
      setCurrentVideo(null)
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a different video clears the current one
  }, [videoId, setCurrentVideo])

  useEffect(() => {
    if (!videoId || !inLibrary || isLoadingYoutubeInfo || isLoadingSongInfo) {
      return
    }
    let info: CurrentPlayingInfo | null = null
    if (songInfo) {
      info = {
        author: songInfo.author,
        thumbnailUrl: songInfo.thumbnailUrl,
        title: songInfo.title,
        videoId: songInfo.videoId,
      }
    } else if (isSongInfoMissing && youtubeInfo) {
      info = {
        author: youtubeInfo.channelTitle,
        thumbnailUrl: youtubeInfo.thumbnail,
        title: youtubeInfo.title,
        videoId,
      }
    }
    if (info !== null) {
      setCurrentVideo(songInfo ?? info)
      addToHistory(info)
    }
  }, [
    videoId,
    inLibrary,
    songInfo,
    youtubeInfo,
    isSongInfoMissing,
    isLoadingSongInfo,
    isLoadingYoutubeInfo,
    addToHistory,
    setCurrentVideo,
  ])
}
