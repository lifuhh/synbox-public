import { AppwriteException, Query } from 'appwrite'

import { getSongDocument } from '@/lib/appwrite/api'
import { appwriteConfig, tables } from '@/lib/appwrite/config'
import type { LyricsRow } from '@/lib/lyrics-api'
import { LOOKUP_ADDRESS } from '@/lib/synbox-flask/address'
import {
  createAppwriteIdFromYoutubeId,
  legacyAppwriteIdFromYoutubeId,
} from '@/utils'

// The reads the app made before lyrics came through the Worker (worker/src/lyrics.ts), used only while the Worker
// doesn't answer its lyrics routes (src/lib/lyrics-api.ts › viaWorker). Removed once the Worker is live

const datesOf = (row: Record<string, unknown>) => ({
  createdAt:
    typeof row.$createdAt === 'string' ? Date.parse(row.$createdAt) : 0,
  updatedAt:
    typeof row.$updatedAt === 'string' ? Date.parse(row.$updatedAt) : 0,
})

export const directLyricsRow = async (
  videoId: string
): Promise<LyricsRow | null> => {
  try {
    const row = await getSongDocument(appwriteConfig.lyricsId, videoId)
    return { row, videoId, ...datesOf(row) }
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 404) {
      return null
    }
    throw error
  }
}

export const directLyricsDates = async (
  videoIds: string[]
): Promise<Map<string, { updatedAt: number }>> => {
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
      Query.select(['$id', '$createdAt', '$updatedAt']),
      Query.limit(rowIds.length),
    ],
    tableId: appwriteConfig.lyricsId,
    total: false,
  })
  const found = new Map<string, { updatedAt: number }>()
  for (const row of page.rows) {
    const videoId = byRowId.get(row.$id)
    if (
      videoId !== undefined &&
      (!found.has(videoId) ||
        row.$id === createAppwriteIdFromYoutubeId(videoId))
    ) {
      found.set(videoId, { updatedAt: datesOf(row).updatedAt })
    }
  }
  return found
}

export const directKaraokeJson = async (
  videoId: string,
  version: number | null,
  signal?: AbortSignal
): Promise<unknown> => {
  const query = version === null ? '' : `?version=${version}`
  const response = await fetch(
    `${LOOKUP_ADDRESS}/karaoke/${encodeURIComponent(videoId)}${query}`,
    { headers: { Accept: 'application/json' }, signal }
  )
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new Error(`Karaoke request failed with status ${response.status}`)
  }
  return await response.json()
}
