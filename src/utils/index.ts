import type { YoutubePlaylist } from '@/lib/youtube/api'

export const shuffleArray = <T>(array: T[]): T[] => {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
  return array
}

// A CJK opening bracket (【「『（) draws in the right half of its square, so text that starts with one looks
// indented by half a character
const OPENING_BRACKET = /^\s*[【「『（〔［｛〈《〖〘〚｟]/u
export const bracketStart = (text: string | undefined) =>
  OPENING_BRACKET.test(text ?? '') && 'bracket-start'

export const handleRedirect = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer')
}

// A private or deleted video stays in its playlist with no thumbnails
const playableItems = (data: YoutubePlaylist) =>
  data.items.flatMap((item) => {
    const thumbnailUrl = item.snippet.thumbnails.high?.url
    return thumbnailUrl === undefined ? [] : [{ item, thumbnailUrl }]
  })

// The Japan charts carry K-pop. Hangul in the title or channel catches most of it; the channels below post
// in English or romanized Korean
const KOREAN = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/u
const KOREAN_CHANNELS = new Set([
  '1theK (원더케이)',
  'BLACKPINK',
  'HYBE LABELS',
  'JYP Entertainment',
  'KQ ENTERTAINMENT',
  'ROSÉ',
  'SMTOWN',
  'Stone Music Entertainment',
])

export const formatYoutubeChartsResponse = (
  data: YoutubePlaylist
): { title: string; id: string }[] =>
  playableItems(data).flatMap(({ item }) => {
    const { title, videoOwnerChannelTitle: channel, resourceId } = item.snippet
    const korean =
      KOREAN.test(title) || KOREAN.test(channel) || KOREAN_CHANNELS.has(channel)
    return korean ? [] : [{ id: resourceId.videoId, title }]
  })

export const extractVideoId = (input: string): string | null => {
  const trimmed = input.trim()

  if (/^[\w-]{11}$/u.test(trimmed)) {
    return trimmed
  }

  const videoIdPattern =
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))(?<id>[^#&?]{11})(?:[#?&]|$)/u

  const fullUrl =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`

  try {
    const matchedId = videoIdPattern.exec(fullUrl)?.groups?.id
    if (matchedId !== undefined && matchedId !== '') {
      return matchedId
    }

    const parsedUrl = new URL(fullUrl)
    const videoId = parsedUrl.searchParams.get('v')
    if (videoId !== null && /^[\w-]{11}$/u.test(videoId)) {
      return videoId
    }

    // Our own links: a song's player (/v/<id>, /v/<id>/versions) or its lyrics (/lyrics/<id>)
    const ownId = /^\/(?:v|lyrics)\/(?<id>[\w-]{11})(?:\/|$)/u.exec(
      parsedUrl.pathname
    )?.groups?.id
    if (ownId !== undefined) {
      return ownId
    }
  } catch (error) {
    console.error('Error parsing YouTube URL:', error)
  }

  return null
}

// Appwrite ids may hold '-' and '_' but not start with one, so only a leading '-' or '_' is encoded.
// Same as the backend's AppwriteService.create_appwrite_id, and reversible.
// The inverse of createAppwriteIdFromYoutubeId. Encoded ids are 14 characters, so an 11-character video
// id that happens to start with yt_h stays as it is
export const youtubeIdFromAppwriteId = (id: string): string => {
  if (id.length === 14 && id.startsWith('yt_h')) {
    return `-${id.slice(4)}`
  }
  if (id.length === 14 && id.startsWith('yt_u')) {
    return `_${id.slice(4)}`
  }
  return id
}

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

// A song's time as the player shows it: 83.4 → "1:23"
export const formatClock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
