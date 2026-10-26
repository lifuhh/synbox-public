import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'

import { parsePreviewVersion } from '@/components/lyrics-display/version-preview-banner'
import { parseLyricsText } from '@/components/player-stage/stage-lyrics'
import { translationIsEnglishAtom } from '@/context/atoms'
import { withoutTrace } from '@/lib/lyrics-api'
import { parseLyricsDocument } from '@/lib/lyrics-document'
import { distinctCharacters, loadLyricsFont } from '@/lib/lyrics-font'
import {
  useGetKaraokeById,
  useGetLyricsBySongId,
  useGetLyricsVersion,
} from '@/lib/react-query/queries-and-mutations'

// Never hold playback longer than this for a slow backend
export const LYRICS_WAIT_MS = 5000

// True once the song's lyrics (or the previewed version) and its karaoke
// timing have arrived or failed, and the font slices their Japanese text
// needs have loaded, so a song that starts singing at once never plays ahead
// of its lyrics. The lyrics overlay reads the same cached queries.
export const useLyricsReady = (videoId: string) => {
  const [searchParams] = useSearchParams()
  const previewVersion = parsePreviewVersion(searchParams.get('version'))
  const active = useGetLyricsBySongId(previewVersion === null ? videoId : '')
  const preview = useGetLyricsVersion(videoId, previewVersion)
  const karaoke = useGetKaraokeById(videoId, previewVersion)
  const lyrics = previewVersion === null ? active : preview
  const settled = !lyrics.isPending && !karaoke.isPending

  // Translations render in Noto Sans, so only the Japanese and romaji count, and the Chinese translation (Noto
  // Sans SC) while it is the one shown
  const [fontsLoadedFor, setFontsLoadedFor] = useState<string | null>(null)
  const doc = parseLyricsText(lyrics.data)
  const english = useAtomValue(translationIsEnglishAtom)
  const chinese =
    settled && !english
      ? withoutTrace(parseLyricsDocument(lyrics.data)?.chi.join('') ?? '')
      : ''
  // Once per song's data, not per render: the timing's text is large, and only its distinct characters matter
  const karaokeData = karaoke.data
  const fontText = useMemo(
    () =>
      settled
        ? distinctCharacters(
            [
              doc.labelled_full_lyrics,
              doc.romaji,
              karaokeData ? JSON.stringify(karaokeData.lines) : undefined,
            ].join('')
          )
        : null,
    [settled, doc.labelled_full_lyrics, doc.romaji, karaokeData]
  )
  useEffect(() => {
    let current = true
    const load = async (text: string) => {
      try {
        await loadLyricsFont(text, chinese)
      } catch {
        // A font that fails to load counts as loaded
      }
      if (current) {
        setFontsLoadedFor(videoId)
      }
    }
    if (fontText !== null) {
      void load(fontText)
    }
    return () => {
      current = false
    }
  }, [fontText, chinese, videoId])

  const [timedOutFor, setTimedOutFor] = useState<string | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => {
      setTimedOutFor(videoId)
    }, LYRICS_WAIT_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [videoId])

  return fontsLoadedFor === videoId || timedOutFor === videoId
}
