import type { CurrentPlayingInfo } from '@/types'
import { createAppwriteIdFromYoutubeId } from '@/utils'

import { appwriteConfig, databases } from './config'

export async function addSongInfoBySongId(songInfo: CurrentPlayingInfo) {
  const { videoId, title, author, thumbnailUrl } = songInfo

  try {
    const appwriteId = createAppwriteIdFromYoutubeId(videoId)

    const songInfoUpload = await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.songInfoId,
      appwriteId,
      {
        title,
        author,
        thumbnailUrl,
      }
    )
    return songInfoUpload
  } catch (error) {
    console.log('Add Song Info Error: ', error)
  }
}

export async function getSongInfoBySongId(
  songId: string
): Promise<CurrentPlayingInfo | null> {
  if (!songId) {
    throw new Error('No Song Id!')
  }

  try {
    const appwriteId = createAppwriteIdFromYoutubeId(songId)

    const songInfo = await databases.getDocument(
      appwriteConfig.databaseId,
      appwriteConfig.songInfoId,
      appwriteId
    )

    if (!songInfo) {
      throw new Error('No song info found')
    }

    const result = {
      videoId: songId,
      title: songInfo.title,
      author: songInfo.author,
      thumbnailUrl: songInfo.thumbnailUrl,
    }

    return result
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'No Song Info found.') {
        return null
      }
      console.error('API Error: ', error)
      throw error
    } else {
      console.error('An unexpected error occurred of unknown type:', error)
      throw new Error('An unknown error occurred')
    }
  }
}

export async function getSongLyricsById(songId: string) {
  if (!songId) {
    throw new Error('No songId given')
  }

  try {
    const appwriteId = createAppwriteIdFromYoutubeId(songId)

    const lyrics = await databases.getDocument(
      appwriteConfig.databaseId,
      appwriteConfig.lyricsId,
      appwriteId
    )

    if (!lyrics) {
      return new Error('No lyrics found')
    }

    return {
      ...lyrics,
      videoId: songId,
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'No Lyrics Found') {
        return null
      }
      console.error('API Error: ', error)
      throw error
    } else {
      console.error('An unexpected error occurred of unknown type:', error)
      throw new Error('An unknown error occurred')
    }
  }
}

interface LyricsDataInterface {
  full_lyrics: string
  plain_lyrics: string
  romaji: string
  eng_translation: string
  chi_translation: string
  labelled_full_lyrics: string
}

export async function uploadLyricsToAppwrite(
  songId: string,
  lyrics: LyricsDataInterface
) {
  if (!songId) {
    throw new Error('No songId found')
  }

  try {
    const appwriteId = createAppwriteIdFromYoutubeId(songId)

    const uploadedLyrics = await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.lyricsId,
      appwriteId,
      {
        ...lyrics,
        visit_count: 0,
      }
    )

    if (!uploadedLyrics) {
      throw new Error('Lyrics not uploaded successfully')
    }

    return uploadedLyrics
  } catch (error) {
    console.log('Lyrics Upload Error: ', error)
    throw error
  }
}
