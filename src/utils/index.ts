import type { YoutubePlaylist } from '@/lib/youtube/api'
import type { ChartSong } from '@/types'

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

// A translation's dash between two words reads as " - ", the owner's rule for translations (the backend's
// tidy() writes new ones that way): an em dash, the Chinese ——, an en dash or "--", spaced or not, becomes a
// hyphen with a space each side, so songs translated before the rule read the same. Hyphenated words, number
// ranges (1–2) and a dash at either end of the line (a cut-off "I was—") stay as written
const DASH = /[ \t]*(?:—+|–+|-{2,})[ \t]*/gu
export const spaceDashes = (text: string) =>
  text.replaceAll(DASH, (match, offset: number) => {
    const before = text.slice(0, offset)
    const after = text.slice(offset + match.length)
    if (before.trim() === '' || after.trim() === '') {
      return match
    }
    const range =
      !match.includes('—') &&
      match.trim() === match &&
      /\d$/u.test(before) &&
      /^\d/u.test(after)
    return range ? match : ' - '
  })

export const handleRedirect = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer')
}

// A private or deleted video stays in its playlist with no thumbnails, and keeps its place in it
const playableItems = (data: YoutubePlaylist) =>
  data.items.flatMap((item, index) => {
    const thumbnailUrl = item.snippet.thumbnails.high?.url
    return thumbnailUrl === undefined ? [] : [{ index, item, thumbnailUrl }]
  })

// The API's counts are decimal strings
const count = (value: string | undefined) => {
  const parsed =
    value === undefined || value === '' ? Number.NaN : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

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

// The rank is the song's place in the chart (offset: the songs on earlier pages), so a skipped song leaves its
// number out rather than renumbering the rest under the chart's name
export const formatYoutubeChartsResponse = (
  data: YoutubePlaylist,
  offset = 0
): ChartSong[] =>
  playableItems(data).flatMap(({ index, item }) => {
    const { title, videoOwnerChannelTitle: channel, resourceId } = item.snippet
    const korean =
      KOREAN.test(title) || KOREAN.test(channel) || KOREAN_CHANNELS.has(channel)
    if (korean) {
      return []
    }
    const id = resourceId.videoId
    const counts = data.statistics[id]
    return [
      {
        id,
        rank: offset + index + 1,
        title,
        views: count(counts?.viewCount),
      },
    ]
  })

export const extractVideoId = (input: string): string | null => {
  const trimmed = input.trim()

  if (/^[\w-]{11}$/u.test(trimmed)) {
    return trimmed
  }

  const videoIdPattern =
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|live\/|watch\?v=|watch\?.+&v=))(?<id>[^#&?]{11})(?:[#?&]|$)/u

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

const OWN_HOSTS = new Set(['synbox.io', 'www.synbox.io', 'synbox.netlify.app'])
const OWN_SONG_PATH =
  /^\/(?:v\/[\w-]{11}(?:\/versions)?|lyrics\/[\w-]{11})\/?$/u

// A pasted link to one of our own song pages, as the in-app path to open (its query, like ?style=, kept)
export const ownSongPath = (input: string): string | null => {
  const trimmed = input.trim()
  try {
    const url = new URL(
      /^https?:\/\//u.test(trimmed) ? trimmed : `https://${trimmed}`
    )
    const own =
      OWN_HOSTS.has(url.hostname) || url.host === globalThis.location?.host
    return own && OWN_SONG_PATH.test(url.pathname)
      ? `${url.pathname}${url.search}`
      : null
  } catch {
    return null
  }
}

// A bare 11-character word only counts as a video id when it has a digit, - or _, or mixed case
const looksLikeLink = (text: string) =>
  /youtube\.com|youtu\.be|https?:\/\//u.test(text) ||
  (/^[\w-]{11}$/u.test(text) &&
    (/[\d_-]/u.test(text) || (/[a-z]/u.test(text) && /[A-Z]/u.test(text))))

// What a search field holds, read the same way by Home, the Search page and the top bar: words to search, one of our
// own song links (opened in the app), a YouTube video, or a link that names no video (a channel, a playlist)
export type FieldText =
  | { kind: 'empty' }
  | { kind: 'search'; query: string }
  | { kind: 'own'; path: string }
  | { kind: 'video'; videoId: string }
  | { kind: 'bad' }

export const BAD_LINK = 'Paste a link to a YouTube video'

export const readFieldText = (input: string): FieldText => {
  const text = input.trim()
  if (text === '') {
    return { kind: 'empty' }
  }
  const path = ownSongPath(text)
  if (path !== null) {
    return { kind: 'own', path }
  }
  if (!looksLikeLink(text)) {
    return { kind: 'search', query: text }
  }
  const videoId = extractVideoId(text)
  return videoId === null ? { kind: 'bad' } : { kind: 'video', videoId }
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

const two = (n: number) => String(n).padStart(2, '0')

// A moment in the listener's own time zone, day first, 24-hour: "25/10/26 01:40"
export const formatStamp = (ms: number) => {
  const at = new Date(ms)
  return `${two(at.getDate())}/${two(at.getMonth() + 1)}/${two(at.getFullYear() % 100)} ${two(at.getHours())}:${two(at.getMinutes())}`
}
