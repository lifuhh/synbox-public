import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'

import { parsePreviewVersion } from '@/components/lyrics-display/VersionPreviewBanner'
import {
  useGetKaraokeById,
  useGetLyricsBySongId,
  useGetLyricsVersion,
} from '@/lib/react-query/queriesAndMutations'

// Never hold playback longer than this for a slow backend
export const LYRICS_WAIT_MS = 5000

// True once the song's lyrics (or the previewed version) and its karaoke
// timing have arrived or failed, so a song that starts singing at once never
// plays ahead of its lyrics. The lyrics overlay reads the same cached queries.
export const useLyricsReady = (videoId: string) => {
  const [searchParams] = useSearchParams()
  const previewVersion = parsePreviewVersion(searchParams.get('version'))
  const active = useGetLyricsBySongId(previewVersion === null ? videoId : '')
  const preview = useGetLyricsVersion(videoId, previewVersion)
  const karaoke = useGetKaraokeById(videoId)
  const lyrics = previewVersion === null ? active : preview
  const settled = !lyrics.isPending && !karaoke.isPending

  const [timedOutFor, setTimedOutFor] = useState<string | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => {
      setTimedOutFor(videoId)
    }, LYRICS_WAIT_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [videoId])

  return settled || timedOutFor === videoId
}
