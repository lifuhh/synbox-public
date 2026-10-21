import { AppwriteException, Query } from 'appwrite'
import type { Models } from 'appwrite'
import { z } from 'zod'

import type { CurrentPlayingInfo } from '@/types'
import {
  createAppwriteIdFromYoutubeId,
  legacyAppwriteIdFromYoutubeId,
  shuffleArray,
  youtubeIdFromAppwriteId,
} from '@/utils'

import { appwriteConfig, tables } from './config'

const songInfoDocumentSchema = z.object({
  author: z.string(),
  thumbnailUrl: z.string(),
  title: z.string(),
})

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

    const result = {
      author: songInfo.data.author,
      thumbnailUrl: songInfo.data.thumbnailUrl,
      title: songInfo.data.title,
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

// Appwrite's largest page, and the most ids one equal() query takes
const PAGE = 100

const galleryRowSchema = songInfoDocumentSchema.extend({ $id: z.string() })

export interface GallerySong {
  videoId: string
  title: string
  author: string
  thumbnailUrl: string
}

// Which of `videoIds` have saved lyrics: one query per hundred songs, run together
export const songsWithLyrics = async (videoIds: string[]) => {
  const ids = videoIds.map(createAppwriteIdFromYoutubeId)
  const chunks = Array.from({ length: Math.ceil(ids.length / PAGE) }, (_, i) =>
    ids.slice(i * PAGE, (i + 1) * PAGE)
  )
  const pages = await Promise.all(
    chunks.map(
      async (chunk) =>
        await tables.listRows({
          databaseId: appwriteConfig.databaseId,
          queries: [
            Query.equal('$id', chunk),
            Query.select(['$id']),
            Query.limit(PAGE),
          ],
          tableId: appwriteConfig.lyricsId,
          total: false,
        })
    )
  )
  return new Set(
    pages.flatMap((page) =>
      page.rows.map((row) => youtubeIdFromAppwriteId(row.$id))
    )
  )
}

// Every song with lyrics on the site, in a fresh order each visit. A song-info row is also written when a
// song is only opened, so the rows are checked against the lyrics
// Every song with lyrics, as ids only and shuffled, so the gallery knows its whole length from a few small
// requests; the lyrics table has a row exactly for each of them
export const listGallerySongIds = async (): Promise<string[]> => {
  const rowIds: string[] = []
  for (;;) {
    const last = rowIds.at(-1)
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page starts after the last row of the one before
    const page = await tables.listRows({
      databaseId: appwriteConfig.databaseId,
      queries: [
        Query.select(['$id']),
        Query.limit(PAGE),
        ...(last === undefined ? [] : [Query.cursorAfter(last)]),
      ],
      tableId: appwriteConfig.lyricsId,
      total: false,
    })
    rowIds.push(...page.rows.map((row) => row.$id))
    if (page.rows.length < PAGE) {
      break
    }
  }
  // A song saved under both id encodings has two rows
  return shuffleArray([...new Set(rowIds.map(youtubeIdFromAppwriteId))])
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
