import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'

import type { KaraokeLineHandle } from '@/components/lyrics-display/KaraokeLine'
import { KaraokeLine } from '@/components/lyrics-display/KaraokeLine'
import { KaraokeRomajiLine } from '@/components/lyrics-display/KaraokeRomajiLine'
import { RubyText } from '@/components/lyrics-display/RubyText'
import {
  fontSizeMultiplierAtom,
  lyricsBackdropAtom,
  lyricsCustomHueAtom,
  lyricsThemeIdAtom,
  lyricsVisibilityAtom,
  romajiVisibilityAtom,
  translationIsEnglishAtom,
  translationVisibilityAtom,
} from '@/context/atoms'
import { parseRubyHtml } from '@/lib/furigana'
import type { PlaybackClock } from '@/lib/karaoke'
import {
  advancePlaybackClock,
  currentLineIndex,
  karaokeMatchesLyrics,
} from '@/lib/karaoke'
import { getLyricsThemeColors, getLyricsThemeCssVars } from '@/lib/lyricsThemes'
import {
  useGetKaraokeById,
  useGetLyricsBySongId,
  useGetLyricsVersion,
} from '@/lib/react-query/queriesAndMutations'
import type { ProbeSample } from '@/lib/timing-probe'
import { summarizeProbe, timingProbeEnabled } from '@/lib/timing-probe'
import { cn } from '@/utils/cn'

import { DraggableLyrics } from './DraggableLyrics'
import type { StageLayout } from './PlayerStage'
import type { StagePlayer } from './useYouTubePlayer'

const lyricLineSchema = z.object({
  startSeconds: z.number(),
  endSeconds: z.number(),
  text: z.string(),
})
const lyricsDocumentSchema = z.object({
  labelled_full_lyrics: z.string(),
  eng_translation: z.string(),
  chi_translation: z.string(),
  romaji: z.string(),
})
// Fields read before (or without) a full parse; a missing or malformed field
// reads as absent rather than failing the others
const optionalText = z
  .unknown()
  .transform((value) => (typeof value === 'string' ? value : undefined))
const lyricsTextSchema = z.object({
  labelled_full_lyrics: optionalText,
  plain_lyrics: optionalText,
  romaji: optionalText,
})
export interface LyricsText {
  labelled_full_lyrics?: string
  plain_lyrics?: string
  romaji?: string
}
export const parseLyricsText = (data: unknown): LyricsText => {
  const result = lyricsTextSchema.safeParse(data)
  return result.success ? result.data : {}
}
const parseJsonWith = <T,>(schema: z.ZodType<T>, raw: string): T | null => {
  try {
    const result = schema.safeParse(JSON.parse(raw))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export interface TimedLyrics {
  lines: z.infer<typeof lyricLineSchema>[]
  eng: string[]
  chi: string[]
  romaji: string[]
}

export const parseLyricsDocument = (data: unknown): TimedLyrics | null => {
  const document = lyricsDocumentSchema.safeParse(data)
  if (!document.success) {
    return null
  }
  const texts = z.array(z.string())
  const lines = parseJsonWith(
    z.array(lyricLineSchema),
    document.data.labelled_full_lyrics
  )
  const eng = parseJsonWith(texts, document.data.eng_translation)
  const chi = parseJsonWith(texts, document.data.chi_translation)
  const romaji = parseJsonWith(texts, document.data.romaji)
  if (!(lines && eng && chi && romaji)) {
    return null
  }
  return { lines, eng, chi, romaji }
}

// Everything the overlay draws runs this far ahead of the player's clock: on a device the lyrics read
// 100–200 ms behind the voice, from the embed reporting its time late and the frame it takes to paint
const LYRICS_LEAD_SEC = 0.15

const findLineIndex = (lines: TimedLyrics['lines'], time: number) =>
  lines.findIndex((line) => time >= line.startSeconds && time < line.endSeconds)

const JAPANESE = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/u
const LATIN = /[a-zA-Z]/u
const isLatinOnly = (html: string) => {
  const text = html.replace(/<[^>]*>/gu, '')
  return LATIN.test(text) && !JAPANESE.test(text)
}

const sameText = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

// Lyrics scale with the stage, but never below a size a phone can read
const LYRIC_SIZE = {
  primary: 'calc(max(3.5cqw, 1.5rem) * var(--lyric-scale))',
  secondary: 'calc(max(2.4cqw, 0.9375rem) * var(--lyric-scale))',
} as const

const LyricLine = ({ html, primary }: { html: string; primary: boolean }) => {
  const segments = useMemo(() => parseRubyHtml(html), [html])
  const latin = !primary || isLatinOnly(html)
  return (
    <p
      className={cn(
        'lyric-text-line text-center text-balance',
        // Room above a Japanese line for its furigana when it wraps
        latin
          ? 'font_noto_sans_reg leading-normal'
          : 'font_noto_sans_jp_black_900 leading-loose',
        !primary && 'lyric-text-line--secondary'
      )}
      style={{
        fontSize: primary ? LYRIC_SIZE.primary : LYRIC_SIZE.secondary,
      }}>
      <RubyText segments={segments} />
    </p>
  )
}

export const StageLyrics = ({
  videoId,
  player,
  layout,
  version = null,
  placeholder,
}: {
  videoId: string
  player: StagePlayer
  layout: StageLayout
  // A saved lyrics version to preview instead of the song's active lyrics
  version?: number | null
  placeholder?: string
}) => {
  const { data: activeLyrics } = useGetLyricsBySongId(
    version === null ? videoId : ''
  )
  const { data: versionLyrics } = useGetLyricsVersion(videoId, version)
  const data = version === null ? activeLyrics : versionLyrics
  const lyrics = useMemo(() => parseLyricsDocument(data), [data])
  const [index, setIndex] = useState(-1)

  // v2 timing applies only when it was generated for exactly these lines
  const { data: karaokeDoc } = useGetKaraokeById(videoId, version)
  const plainLyrics = useMemo(() => parseLyricsText(data).plain_lyrics, [data])
  const karaokeLines = useMemo(
    () =>
      karaokeDoc && karaokeMatchesLyrics(karaokeDoc.lines, plainLyrics)
        ? karaokeDoc.lines
        : null,
    [karaokeDoc, plainLyrics]
  )
  const karaokeRef = useRef<KaraokeLineHandle>(null)
  const karaokeRomajiRef = useRef<KaraokeLineHandle>(null)
  const clockRef = useRef<PlaybackClock | null>(null)
  const playingRef = useRef(false)
  const playing = player.phase.kind === 'playing'
  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  const showLyrics = useAtomValue(lyricsVisibilityAtom)
  const showRomaji = useAtomValue(romajiVisibilityAtom)
  const showTranslation = useAtomValue(translationVisibilityAtom)
  const english = useAtomValue(translationIsEnglishAtom)
  const scale = useAtomValue(fontSizeMultiplierAtom)
  const backdrop = useAtomValue(lyricsBackdropAtom)
  const themeId = useAtomValue(lyricsThemeIdAtom)
  const hue = useAtomValue(lyricsCustomHueAtom)
  const themeVars = useMemo(
    () => getLyricsThemeCssVars(getLyricsThemeColors(themeId, hue)),
    [themeId, hue]
  )

  const { subscribeFrame } = player
  // ?timingProbe=1: one recording per page, across line changes
  const probeRef = useRef<ProbeSample[] | null>(null)
  useEffect(() => {
    if (!timingProbeEnabled() || probeRef.current !== null) {
      return
    }
    const samples: ProbeSample[] = []
    probeRef.current = samples
    Reflect.set(window, '__synboxTimingProbe', {
      player: () => ({
        get currentTime() {
          return player.getTime()
        },
        get paused() {
          return !playingRef.current
        },
      }),
      samples,
      summary: () => summarizeProbe(samples),
    })
  }, [player])

  useEffect(() => {
    if (karaokeLines) {
      return subscribeFrame((reported) => {
        // YouTube reports time in steps; the clock smooths it for the fill
        clockRef.current = advancePlaybackClock(clockRef.current, {
          mediaTime: reported,
          now: performance.now(),
          playing: playingRef.current,
          rate: 1,
        })
        const time = clockRef.current.time + LYRICS_LEAD_SEC
        probeRef.current?.push({
          clock: clockRef.current.time,
          now: performance.now(),
          playing: playingRef.current,
          reported,
        })
        setIndex(currentLineIndex(karaokeLines, time))
        karaokeRef.current?.setTime(time)
        karaokeRomajiRef.current?.setTime(time)
      })
    }
    if (!lyrics) {
      return
    }
    return subscribeFrame((time) => {
      setIndex(findLineIndex(lyrics.lines, time + LYRICS_LEAD_SEC))
    })
  }, [lyrics, karaokeLines, subscribeFrame])

  const karaokeLine = karaokeLines?.[index]
  const line = lyrics?.lines[index]
  const text = karaokeLine?.text ?? line?.text ?? placeholder
  if (text === undefined) {
    return null
  }
  const translation = (english ? lyrics?.eng : lyrics?.chi)?.[index] ?? ''
  const romaji = lyrics?.romaji[index] ?? ''

  return (
    <DraggableLyrics
      layout={layout}
      scale={scale}
      backdrop={backdrop}
      style={themeVars}>
      {showTranslation && translation && !sameText(translation, text) && (
        <LyricLine html={translation} primary={false} />
      )}
      {showLyrics &&
        (karaokeLine ? (
          <div className='text-center' style={{ fontSize: LYRIC_SIZE.primary }}>
            <KaraokeLine key={index} ref={karaokeRef} line={karaokeLine} />
          </div>
        ) : (
          <LyricLine html={text} primary />
        ))}
      {showRomaji &&
        (karaokeLine ? (
          <div
            className='text-center'
            style={{ fontSize: LYRIC_SIZE.secondary }}>
            <KaraokeRomajiLine
              key={index}
              ref={karaokeRomajiRef}
              line={karaokeLine}
            />
          </div>
        ) : (
          romaji &&
          !sameText(romaji, text) && <LyricLine html={romaji} primary={false} />
        ))}
    </DraggableLyrics>
  )
}
