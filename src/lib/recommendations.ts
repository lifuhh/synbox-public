import { z } from 'zod'

import type {
  CurrentPlayingInfo,
  formattedYoutubeVideoItemForCarousel,
} from '@/types'
import { shuffleArray } from '@/utils'

// The landing page's Recommendations, kept by the auth Worker (GET /api/recommendations) and edited on the
// admin page

const recommendationSchema = z.object({
  author: z.string(),
  thumbnailUrl: z.string(),
  title: z.string(),
  videoId: z.string(),
})

export type Recommendation = z.infer<typeof recommendationSchema>

// The Worker caps the list at this many songs
export const MAX_RECOMMENDATIONS = 100

// The Worker takes only YouTube's own thumbnail host (worker/src/recommendations.ts › THUMBNAIL); any other
// picture falls back to the video's standard one there
export const toRecommendation = (song: CurrentPlayingInfo): Recommendation => ({
  author: song.author,
  thumbnailUrl: song.thumbnailUrl.startsWith('https://i.ytimg.com/')
    ? song.thumbnailUrl
    : `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`,
  title: song.title,
  videoId: song.videoId,
})

// `fresh` reads what was saved, for the admin's edits. The browser and Netlify's edge each keep a one-minute
// copy, and the edge ignores the browser's no-cache, so a fresh read asks for a URL neither has stored. Read from a
// copy, an edit made within the minute is missing, and the next edit, built on that list, undoes it
export const fetchRecommendations = async ({ fresh = false } = {}) => {
  const response = await fetch(
    fresh ? `/api/recommendations?at=${Date.now()}` : '/api/recommendations',
    { cache: fresh ? 'no-store' : 'default' }
  )
  if (!response.ok) {
    throw new Error(`/api/recommendations answered ${response.status}`)
  }
  const result = z
    .object({ songs: z.array(recommendationSchema) })
    .safeParse(await response.json())
  if (!result.success) {
    throw new Error('Page out of date. Reload')
  }
  return result.data.songs
}

// In a new order on every visit
export const getLandingPagePlaylist = async (): Promise<
  formattedYoutubeVideoItemForCarousel[]
> => {
  const songs = await fetchRecommendations()
  return shuffleArray(
    songs.map(({ author, thumbnailUrl, title, videoId }) => ({
      channel: author,
      thumbnailUrl,
      title,
      videoId,
    }))
  )
}
