import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { KaraokeLineHandle } from '@/components/lyrics-display/karaoke-line'
import { LINE_HOLD } from '@/lib/karaoke'
import type { OfflineLine } from '@/lib/offline/song'

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

  // The page follows the line being sung until the reader scrolls it themselves; Current Line, a seek or
  // a tap on a line picks it back up
  const [following, setFollowing] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)
  const blocks = useRef<(HTMLDivElement | null)[]>([])
  useEffect(() => {
    const box = scroller.current
    const block = blocks.current[reached]
    if (
      synced &&
      following &&
      box !== null &&
      block !== undefined &&
      block !== null
    ) {
      box.scrollTo({
        behavior: 'smooth',
        top:
          box.scrollTop +
          block.getBoundingClientRect().top -
          box.getBoundingClientRect().top -
          box.clientHeight * FOLLOW_AT,
      })
    }
  }, [synced, following, reached])

  const seek = (to: number) => {
    playback.seek(to)
    setFollowing(true)
  }
  const togglePlay = () => {
    if (playback.playing) {
      playback.pause()
    } else {
      playback.play()
      setFollowing(true)
    }
  }
  const userScrolled = () => {
    if (synced) {
      setFollowing(false)
    }
  }

  return {
    active,
    blocks,
    duration,
    following,
    karaokeLines,
    playback,
    playedTime,
    scroller,
    seek,
    setFollowing,
    togglePlay,
    userScrolled,
  }
}
