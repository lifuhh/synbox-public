import type {
  FormatYoutubeResponseFunction,
  InfiniteGalleryVideoItem,
  YoutubePlaylistApiResponse,
  YoutubePlaylistItem,
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

export function formatYoutubeChartsResponse(
  data: YoutubePlaylistApiResponse
): { title: string; id: string }[] {
  const items = data.items.map(
    (item: YoutubePlaylistItem): { title: string; id: string } => ({
      title: item.snippet.title,
      id: item.snippet.resourceId?.videoId,
    })
  )

  return items
}

export function formatYoutubePlaylistResponse(
  data: YoutubePlaylistApiResponse
): formattedYoutubeVideoItemForCarousel[] {
  const items = data.items.map(
    (item: YoutubePlaylistItem): formattedYoutubeVideoItemForCarousel => {
      const maxDescriptionLength = 80

      return {
        title: item.snippet.title,
        channel: item.snippet.videoOwnerChannelTitle || 'Unknown',
        description: trimLength(
          item.snippet.description,
          maxDescriptionLength,
          true
        ),
        thumbnailUrl: item.snippet.thumbnails.high.url,
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
    const items = data.items.map((item): InfiniteGalleryVideoItem => ({
      title: item.snippet.title,
      channel: item.snippet.videoOwnerChannelTitle || 'Unknown',
      thumbnailUrl: item.snippet.thumbnails.high.url,
      videoId: item.snippet.resourceId?.videoId || '',
    }))

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

export const createAppwriteIdFromYoutubeId = (id: string): string => {
  if (!id) {
    return ''
  }

  if (validateYoutubeIdForAppwrite(id)) {
    return id
  }

  return encodeYoutubeIdForAppwrite(id)
}

const validateYoutubeIdForAppwrite = (id: string): boolean => {
  const validChars = /^[a-zA-Z0-9_]{1,36}$/
  return validChars.test(id) && !id.startsWith('_')
}

const encodeYoutubeIdForAppwrite = (id: string): string => {
  const prefix = 'yt_'
  const encodedId = id.replace(/-/g, '_')
  return `${prefix}${encodedId}`
}

export const delayApiResponse = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms))
