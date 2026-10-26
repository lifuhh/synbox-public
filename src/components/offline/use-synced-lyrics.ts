import { useCallback, useEffect, useMemo, useRef } from 'react'

import type { KaraokeLineHandle } from '@/components/lyrics-display/karaoke-line'
import { LINE_HOLD } from '@/lib/karaoke'
import type { OfflineLine } from '@/lib/offline/song'

import { useLyricsFollow } from './use-lyrics-follow'
import { useSilentPlayback } from './use-silent-playback'

// How far down the page the line being sung sits while the lyrics follow the clock
const FOLLOW_AT = 0.3

// Synced lyrics on the reader page: the silent clock, the karaoke fill of the line being sung, and the page
// following that line until the reader scrolls it themselves
export const useSyncedLyrics = (lines: OfflineLine[], synced: boolean) => {
  const duration = useMemo(() => {
    let end = 0
    for (const line of lines) {
      end = Math.max(end, line.end)
    }
    // Long enough for the last line to clear once it is sung
    return end + LINE_HOLD
  }, [lines])

  // The clock drives the line being sung frame by frame; every other line shows as sung
  const karaokeLines = useRef<(KaraokeLineHandle | null)[]>([])
  const fillingLine = useRef(-1)
  const onFrame = useCallback((time: number) => {
    karaokeLines.current[fillingLine.current]?.setTime(time)
  }, [])
  const playback = useSilentPlayback(lines, duration, onFrame)
  const { active, reached, time: playedTime } = playback
  useEffect(() => {
    if (fillingLine.current !== active) {
      karaokeLines.current[fillingLine.current]?.setTime(Infinity)
      fillingLine.current = active
    }
    karaokeLines.current[active]?.setTime(playedTime)
  }, [active, playedTime])

  // The page follows the line being sung until the reader scrolls it themselves; a pause in their scrolling,
  // Current Line, a seek or a tap on a line picks it back up
  const { blocks, content, follow, following, handlers, scroller } =
    useLyricsFollow<HTMLElement>({
      enabled: synced,
      followAt: FOLLOW_AT,
      isPlaying: () => playback.playing,
      // The line being sung, and the last one reached only through a gap (lineFollowed): never the next line
      // while this one is still sung. Before the first line, the first line waits in its place
      target: Math.max(active >= 0 ? active : reached, 0),
    })

  const seek = (to: number) => {
    playback.seek(to)
    follow()
  }
  const togglePlay = () => {
    if (playback.playing) {
      playback.pause()
    } else {
      playback.play()
      follow()
    }
  }

  return {
    active,
    blocks,
    content,
    duration,
    follow,
    followHandlers: handlers,
    following,
    karaokeLines,
    // The line to light: the one being sung, or through an instrumental gap the last one reached
    lit: active >= 0 ? active : reached,
    playback,
    playedTime,
    scroller,
    seek,
    togglePlay,
  }
}
