import { AppwriteException } from 'appwrite'

import type { CurrentPlayingInfo } from '@/types'
import {
  createAppwriteIdFromYoutubeId,
  legacyAppwriteIdFromYoutubeId,
} from '@/utils'

import { appwriteConfig, databases } from './config'

// Reads fall back to the pre-migration id, so a song is found while its row is being moved.
const getSongDocument = async (collectionId: string, songId: string) => {
  const id = createAppwriteIdFromYoutubeId(songId)
  const legacyId = legacyAppwriteIdFromYoutubeId(songId)
  try {
    return await databases.getDocument(
      appwriteConfig.databaseId,
      collectionId,
      id
    )
  } catch (error) {
    const isNotFound = error instanceof AppwriteException && error.code === 404
    if (!isNotFound || legacyId === id) {
      throw error
    }
    return await databases.getDocument(
      appwriteConfig.databaseId,
      collectionId,
      legacyId
    )
  }
}

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
    const songInfo = await getSongDocument(appwriteConfig.songInfoId, songId)

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
    const lyrics = await getSongDocument(appwriteConfig.lyricsId, songId)

    return {
      ...lyrics,
      videoId: songId,
    }
  } catch (error) {
    // A song without lyrics yet is the normal answer, not a failure
    if (error instanceof AppwriteException && error.code === 404) {
      return null
    }
    if (error instanceof Error) {
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
