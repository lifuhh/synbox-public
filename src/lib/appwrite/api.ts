import { AppwriteException, Query } from 'appwrite'
import type { Models } from 'appwrite'
import { z } from 'zod'

import type { CurrentPlayingInfo } from '@/types'
import {
  createAppwriteIdFromYoutubeId,
  legacyAppwriteIdFromYoutubeId,
  youtubeIdFromAppwriteId,
} from '@/utils'

import { appwriteConfig, tables } from './config'

const songInfoDocumentSchema = z.object({
  author: z.string(),
  // The song's own name and artist, from the lyrics pipeline's metadata step; missing on songs it has not
  // named, and on rows made here from YouTube's details
  songArtist: z.string().nullish(),
  songTitle: z.string().nullish(),
  thumbnailUrl: z.string(),
  title: z.string(),
})

const orElse = (value: string | null | undefined, fallback: string) => {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? fallback : trimmed
}

// Reads fall back to the pre-migration id, so a song is found while its row is being moved.
const getSongDocument = async (tableId: string, songId: string) => {
  const id = createAppwriteIdFromYoutubeId(songId)
  const legacyId = legacyAppwriteIdFromYoutubeId(songId)
  try {
    return await tables.getRow({
      databaseId: appwriteConfig.databaseId,
      rowId: id,
      tableId,
    })
  } catch (error) {
    const isNotFound = error instanceof AppwriteException && error.code === 404
    if (!isNotFound || legacyId === id) {
      throw error
    }
    return await tables.getRow({
      databaseId: appwriteConfig.databaseId,
      rowId: legacyId,
      tableId,
    })
  }
}

export const addSongInfoBySongId = async (songInfo: CurrentPlayingInfo) => {
  const { videoId, title, author, thumbnailUrl } = songInfo

  let songInfoUpload: Models.DefaultRow | undefined
  try {
    const appwriteId = createAppwriteIdFromYoutubeId(videoId)

    songInfoUpload = await tables.createRow({
      data: {
        author,
        thumbnailUrl,
        title,
      },
      databaseId: appwriteConfig.databaseId,
      rowId: appwriteId,
      tableId: appwriteConfig.songInfoId,
    })
  } catch (error) {
    console.log('Add Song Info Error:', error)
  }
  return songInfoUpload
}

export const getSongInfoBySongId = async (
  songId: string
): Promise<CurrentPlayingInfo | null> => {
  if (!songId) {
    throw new Error('No Song Id!')
  }

  try {
    const document = await getSongDocument(appwriteConfig.songInfoId, songId)
    const songInfo = songInfoDocumentSchema.safeParse(document)

    if (!songInfo.success) {
      throw new Error('Song info is malformed')
    }

    // 月の温度 by JELEE rather than the video's "JELEE『月の温度』Music Video" by its channel
    const { songTitle, songArtist } = songInfo.data
    const result = {
      author: orElse(songArtist, songInfo.data.author),
      thumbnailUrl: songInfo.data.thumbnailUrl,
      title: orElse(songTitle, songInfo.data.title),
      videoId: songId,
    }

    return result
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'No Song Info found.') {
        return null
      }
      console.error('API Error:', error)
      throw error
    } else {
      console.error('An unexpected error occurred of unknown type:', error)
      throw new Error('An unknown error occurred', { cause: error })
    }
  }
}

export const getSongLyricsById = async (songId: string) => {
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
      console.error('API Error:', error)
      throw error
    } else {
      console.error('An unexpected error occurred of unknown type:', error)
      throw new Error('An unknown error occurred', { cause: error })
    }
  }
}

const galleryRowSchema = songInfoDocumentSchema.extend({ $id: z.string() })

export interface GallerySong {
  videoId: string
  title: string
  author: string
  thumbnailUrl: string
}

// The cards for one stretch of the gallery, in the order asked for; a song without its info row is left out
export const getGallerySongs = async (
  videoIds: string[]
): Promise<GallerySong[]> => {
  if (videoIds.length === 0) {
    return []
  }
  const page = await tables.listRows({
    databaseId: appwriteConfig.databaseId,
    queries: [
      Query.equal('$id', videoIds.map(createAppwriteIdFromYoutubeId)),
      Query.select(['$id', 'title', 'author', 'thumbnailUrl']),
      Query.limit(videoIds.length),
    ],
    tableId: appwriteConfig.songInfoId,
    total: false,
  })
  const byId = new Map(
    page.rows.map((row) => {
      const { $id, author, thumbnailUrl, title } = galleryRowSchema.parse(row)
      const videoId = youtubeIdFromAppwriteId($id)
      return [videoId, { author, thumbnailUrl, title, videoId }] as const
    })
  )
  return videoIds.flatMap((videoId) => byId.get(videoId) ?? [])
}

const lyricsRowDatesSchema = z.object({
  $createdAt: z.string(),
  $id: z.string(),
  $updatedAt: z.string(),
})

export interface LyricsRow {
  videoId: string
  // When the song was first generated, and when its live lyrics were last written, in ms
  createdAt: number
  updatedAt: number
  row: Models.DefaultRow
}

// The lyrics rows of up to 50 songs, by video id; a song without lyrics is left out. Each id is asked under
// both encodings, and the current one wins, as in getSongDocument. `datesOnly` leaves the lyrics out
export const getLyricsRows = async (
  videoIds: string[],
  { datesOnly = false } = {}
): Promise<Map<string, LyricsRow>> => {
  const byRowId = new Map<string, string>()
  for (const videoId of videoIds) {
    byRowId.set(legacyAppwriteIdFromYoutubeId(videoId), videoId)
    byRowId.set(createAppwriteIdFromYoutubeId(videoId), videoId)
  }
  const rowIds = [...byRowId.keys()]
  const page = await tables.listRows({
    databaseId: appwriteConfig.databaseId,
    queries: [
      Query.equal('$id', rowIds),
      ...(datesOnly ? [Query.select(['$id', '$createdAt', '$updatedAt'])] : []),
      Query.limit(rowIds.length),
    ],
    tableId: appwriteConfig.lyricsId,
    total: false,
  })
  const found = new Map<string, LyricsRow>()
  for (const row of page.rows) {
    const { $createdAt, $id, $updatedAt } = lyricsRowDatesSchema.parse(row)
    const videoId = byRowId.get($id)
    if (
      videoId !== undefined &&
      (!found.has(videoId) || $id === createAppwriteIdFromYoutubeId(videoId))
    ) {
      found.set(videoId, {
        createdAt: Date.parse($createdAt),
        row,
        updatedAt: Date.parse($updatedAt),
        videoId,
      })
    }
  }
  return found
}
