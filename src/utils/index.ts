import type {
  FormatYoutubeResponseFunction,
  InfiniteGalleryVideoItem,
  YoutubePlaylistApiResponse,
  formattedYoutubeVideoItemForCarousel,
} from '@/types'

const shuffleArray = (array: unknown[]) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
  return array
}

export const handleRedirect = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function trimLength(text: string, maxLength: number, trail: boolean) {
  const tooLong = text.length > maxLength

  const editedText = tooLong ? text.substring(0, maxLength) : text

  return trail ? (tooLong ? `${editedText}...` : editedText) : editedText
}

// A private or deleted video stays in its playlist with no thumbnails
const playableItems = (data: YoutubePlaylistApiResponse) =>
  data.items.flatMap((item) => {
    const thumbnailUrl = item.snippet.thumbnails.high?.url
    return thumbnailUrl === undefined ? [] : [{ item, thumbnailUrl }]
  })

export function formatYoutubeChartsResponse(
  data: YoutubePlaylistApiResponse
): { title: string; id: string }[] {
  const items = playableItems(data).map(
    ({ item }): { title: string; id: string } => ({
      title: item.snippet.title,
      id: item.snippet.resourceId?.videoId,
    })
  )

  return items
}

export function formatYoutubePlaylistResponse(
  data: YoutubePlaylistApiResponse
): formattedYoutubeVideoItemForCarousel[] {
  const items = playableItems(data).map(
    ({ item, thumbnailUrl }): formattedYoutubeVideoItemForCarousel => {
      const maxDescriptionLength = 80

      return {
        title: item.snippet.title,
        channel: item.snippet.videoOwnerChannelTitle || 'Unknown',
        description: trimLength(
          item.snippet.description,
          maxDescriptionLength,
          true
        ),
        thumbnailUrl,
        videoId: item.snippet.resourceId?.videoId,
      }
    }
  )

  const shuffledResults = shuffleArray(
    items
  ) as formattedYoutubeVideoItemForCarousel[]

  return shuffledResults.slice(0, 50)
}

export const formatYoutubeInfiniteGalleryResponse: FormatYoutubeResponseFunction =
  (data: YoutubePlaylistApiResponse): InfiniteGalleryVideoItem[] => {
    const items = playableItems(data).map(
      ({ item, thumbnailUrl }): InfiniteGalleryVideoItem => ({
        title: item.snippet.title,
        channel: item.snippet.videoOwnerChannelTitle || 'Unknown',
        thumbnailUrl,
        videoId: item.snippet.resourceId?.videoId || '',
      })
    )

    return items
  }

export const extractVideoId = (input: string): string | null => {
  input = input.trim()

  if (/^[\w-]{11}$/.test(input)) {
    return input
  }

  const videoIdPattern =
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^#&?]{11})(?:[#?&]|$)/

  const fullUrl =
    input.startsWith('http://') || input.startsWith('https://')
      ? input
      : `https://${input}`

  try {
    const match = fullUrl.match(videoIdPattern)
    if (match && match[1]) {
      return match[1]
    }

    const parsedUrl = new URL(fullUrl)
    const videoId = parsedUrl.searchParams.get('v')
    if (videoId && /^[\w-]{11}$/.test(videoId)) {
      return videoId
    }
  } catch (error) {
    console.error('Error parsing YouTube URL:', error)
  }

  return null
}

// Appwrite ids may hold '-' and '_' but not start with one, so only a leading '-' or '_' is encoded.
// Same as the backend's AppwriteService.create_appwrite_id, and reversible.
export const createAppwriteIdFromYoutubeId = (id: string): string => {
  if (id.startsWith('-')) {
    return `yt_h${id.slice(1)}`
  }
  if (id.startsWith('_')) {
    return `yt_u${id.slice(1)}`
  }
  return id
}

// Rows saved before the 2026-10 id migration used 'yt_' + id with every '-' as '_'.
export const legacyAppwriteIdFromYoutubeId = (id: string): string =>
  /^[a-zA-Z0-9_]{1,36}$/u.test(id) && !id.startsWith('_')
    ? id
    : `yt_${id.split('-').join('_')}`

export const delayApiResponse = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms))
