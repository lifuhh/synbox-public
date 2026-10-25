import { getVideoFacts } from '@/lib/youtube/api'
import { playsOutsideYouTube } from '@/lib/youtube/embed-check'
import { isoSeconds, LONGEST_S, SHORTEST_S } from '@/lib/youtube/song-guess'

import type { Refusal } from './stream'

// The video checks a new song passes on the backend (synbox-transcribe-whisper › services/video_validation.py:
// it exists, 1 to 8 minutes, plays in an embedded player), asked when its button is pressed, so a video that
// can't be made shows its reason there instead of failing the first step of a generation that already started.
// The backend still checks: a video can change, and YouTube's "viewer discretion" gate shows only to it

// How long the embedded player gets to say whether the video plays outside YouTube
const EMBED_CHECK_MS = 6000

export interface VideoFacts {
  title: string
  // null when YouTube gave no length
  seconds: number | null
}

export const VIDEO_REFUSALS = {
  not_found: 'No video at this link. It may be private or deleted.',
  too_long: 'Too long. Songs can be 1 to 8 minutes.',
  too_short: 'Too short. Songs can be 1 to 8 minutes.',
  youtube_only:
    'YouTube only lets this video play on youtube.com. Try another upload.',
} as const

const refusal = (code: keyof typeof VIDEO_REFUSALS): Refusal => ({
  code,
  message: VIDEO_REFUSALS[code],
})

// `facts`: null when YouTube has no such video, 'unknown' when it couldn't be asked (then only the player's answer
// counts). `plays`: whether the embedded player played it
export const videoRefusal = (
  facts: VideoFacts | null | 'unknown',
  plays: boolean
): Refusal | null => {
  if (facts === null) {
    return refusal('not_found')
  }
  if (facts !== 'unknown' && facts.seconds !== null && facts.seconds > 0) {
    if (facts.seconds > LONGEST_S) {
      return refusal('too_long')
    }
    if (facts.seconds < SHORTEST_S) {
      return refusal('too_short')
    }
  }
  return plays ? null : refusal('youtube_only')
}

// Asks YouTube and the embedded player at once. The title, when YouTube answered, names the song in the button's
// confirmation and in the panel before the backend sends its own
export const checkVideo = async (
  videoId: string
): Promise<{ refusal: Refusal | null; title: string | null }> => {
  const [facts, plays] = await Promise.all([
    getVideoFacts(videoId).then(
      (found) =>
        found === null
          ? null
          : {
              seconds:
                found.duration === null ? null : isoSeconds(found.duration),
              title: found.title,
            },
      (): 'unknown' => 'unknown'
    ),
    playsOutsideYouTube(videoId, AbortSignal.timeout(EMBED_CHECK_MS)),
  ])
  return {
    refusal: videoRefusal(facts, plays),
    title: facts === null || facts === 'unknown' ? null : facts.title,
  }
}
