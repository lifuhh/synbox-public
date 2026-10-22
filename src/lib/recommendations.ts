import { z } from 'zod'

import type { formattedYoutubeVideoItemForCarousel } from '@/types'
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

// `fresh` skips the browser's one-minute copy, so the admin page shows what was saved
export const fetchRecommendations = async ({ fresh = false } = {}) => {
  const response = await fetch('/api/recommendations', {
    cache: fresh ? 'no-cache' : 'default',
  })
  if (!response.ok) {
    throw new Error(`/api/recommendations answered ${response.status}`)
  }
  const body: unknown = await response.json()
  return z.object({ songs: z.array(recommendationSchema) }).parse(body).songs
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
