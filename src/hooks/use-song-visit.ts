import { useSetAtom } from 'jotai'
import { useEffect } from 'react'

import { currentVideoAtom } from '@/context/atoms'
import { addToHistoryAtom } from '@/lib/library/store'
import {
  useAddSongInfoBySongId,
  useGetSongInfoBySongId,
  useGetYoutubeVideoInfo,
} from '@/lib/react-query/queries-and-mutations'

// Publishes the song being watched (currentVideoAtom: title, bookmarks) and
// records it in watch history. A song with no song_info row yet gets one from
// its YouTube metadata.
export const useSongVisit = (videoId: string) => {
  const setCurrentVideo = useSetAtom(currentVideoAtom)
  const addToHistory = useSetAtom(addToHistoryAtom)
  const {
    data: songInfo,
    isLoading: isLoadingSongInfo,
    isError: isSongInfoMissing,
  } = useGetSongInfoBySongId(videoId)
  const { data: youtubeInfo, isLoading: isLoadingYoutubeInfo } =
    useGetYoutubeVideoInfo(videoId)
  const { mutate: addSongInfo } = useAddSongInfoBySongId()

  useEffect(() => {
    setCurrentVideo(null)
    return () => {
      setCurrentVideo(null)
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a different video clears the current one
  }, [videoId, setCurrentVideo])

  useEffect(() => {
    if (!videoId || isLoadingYoutubeInfo || isLoadingSongInfo) {
      return
    }
    if (isSongInfoMissing && youtubeInfo) {
      const info = {
        author: youtubeInfo.channelTitle,
        thumbnailUrl: youtubeInfo.thumbnail,
        title: youtubeInfo.title,
        videoId,
      }
      addSongInfo(info, {
        onSuccess: () => {
          setCurrentVideo(info)
          addToHistory(info)
        },
      })
      return
    }
    if (songInfo) {
      setCurrentVideo(songInfo)
      addToHistory({
        author: songInfo.author,
        thumbnailUrl: songInfo.thumbnailUrl,
        title: songInfo.title,
        videoId: songInfo.videoId,
      })
    }
  }, [
    videoId,
    songInfo,
    youtubeInfo,
    isSongInfoMissing,
    isLoadingSongInfo,
    isLoadingYoutubeInfo,
    addSongInfo,
    addToHistory,
    setCurrentVideo,
  ])
}
