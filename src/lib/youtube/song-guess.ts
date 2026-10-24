import type { YoutubeSearchResultInfo } from '@/types'

// Whether a video not in the library might be a Japanese song, from YouTube's details alone: it decides only
// whether to offer Generate Lyrics. The backend's own check, once a generation starts, is what refuses a video
// that isn't one (an LLM call per press, so the offer is kept to plausible videos)

// Kana, or kanji (Chinese titles pass too; the backend tells them apart)
const JAPANESE_TEXT = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u
// The backend takes songs of 1 to 8 minutes
const SHORTEST_S = 60
const LONGEST_S = 8 * 60

// "PT4M13S" → 253; null for anything else (a live stream's "P0D" is 0)
export const isoSeconds = (duration: string) => {
  const match =
    /^P(?:(?<d>\d+)D)?(?:T(?:(?<h>\d+)H)?(?:(?<m>\d+)M)?(?:(?<s>\d+)S)?)?$/u.exec(
      duration
    )
  if (match?.groups === undefined) {
    return null
  }
  const { d = '0', h = '0', m = '0', s = '0' } = match.groups
  return Number(d) * 86_400 + Number(h) * 3600 + Number(m) * 60 + Number(s)
}

export const mightBeJapaneseSong = (
  video: Pick<
    YoutubeSearchResultInfo,
    'title' | 'channelTitle' | 'tags' | 'defaultAudioLanguage' | 'duration'
  >
) => {
  const seconds = isoSeconds(video.duration)
  if (seconds !== null && (seconds < SHORTEST_S || seconds > LONGEST_S)) {
    return false
  }
  return (
    video.defaultAudioLanguage.toLowerCase().startsWith('ja') ||
    JAPANESE_TEXT.test(
      [video.title, video.channelTitle, ...video.tags].join(' ')
    )
  )
}
