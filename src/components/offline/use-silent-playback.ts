import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { currentLineIndex } from '@/lib/karaoke'

// The bar's clock and time labels need far fewer updates than the karaoke fill
const PUBLISH_MS = 200

interface Clock {
  // Song time at `at` (a performance.now()), and whether it runs from there
  time: number
  at: number
  playing: boolean
}

const readClock = (clock: Clock) =>
  clock.playing
    ? clock.time + (performance.now() - clock.at) / 1000
    : clock.time

// The last line whose lead-in has begun: where the page stays scrolled through an instrumental gap
const lineReached = (lines: readonly { start: number }[], time: number) => {
  let reached = 0
  for (const [index, line] of lines.entries()) {
    if (line.start - 0.5 <= time) {
      reached = index
    }
  }
  return reached
}

// A song's lyrics played without audio: a clock that runs from play, stops at the end and jumps on a seek.
// `onFrame` gets the exact time every frame while it plays (the karaoke fill); React state carries the
// rest: the time a few times a second, the line being sung (-1 between lines) and the line reached
export const useSilentPlayback = (
  lines: readonly { start: number; end: number }[],
  duration: number,
  onFrame: (time: number) => void
) => {
  const clock = useRef<Clock>({ at: 0, playing: false, time: 0 })
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [active, setActive] = useState(-1)
  const [reached, setReached] = useState(0)
  const frame = useRef(onFrame)
  useLayoutEffect(() => {
    frame.current = onFrame
  })

  const publish = useCallback(
    (now: number) => {
      setTime(now)
      setActive(currentLineIndex(lines, now))
      setReached(lineReached(lines, now))
    },
    [lines]
  )

  const seek = useCallback(
    (to: number) => {
      const now = Math.min(Math.max(to, 0), duration)
      clock.current = { ...clock.current, at: performance.now(), time: now }
      publish(now)
      frame.current(now)
    },
    [duration, publish]
  )

  const play = useCallback(() => {
    // From the end, play starts the song again
    const from = clock.current.time >= duration ? 0 : clock.current.time
    clock.current = { at: performance.now(), playing: true, time: from }
    setPlaying(true)
    publish(from)
  }, [duration, publish])

  const pause = useCallback(() => {
    const now = readClock(clock.current)
    clock.current = { at: performance.now(), playing: false, time: now }
    setPlaying(false)
    publish(now)
  }, [publish])

  useEffect(() => {
    let id = 0
    let published = 0
    let publishedLine = -2
    const tick = () => {
      const now = Math.min(readClock(clock.current), duration)
      frame.current(now)
      const line = currentLineIndex(lines, now)
      // A new line shows at once; the time labels can wait
      if (
        performance.now() - published > PUBLISH_MS ||
        line !== publishedLine
      ) {
        published = performance.now()
        publishedLine = line
        setTime(now)
        setActive(line)
        setReached(lineReached(lines, now))
      }
      if (now >= duration) {
        clock.current = { at: performance.now(), playing: false, time: now }
        setPlaying(false)
        return
      }
      id = requestAnimationFrame(tick)
    }
    if (playing) {
      id = requestAnimationFrame(tick)
    }
    return () => {
      cancelAnimationFrame(id)
    }
  }, [playing, duration, lines])

  // A phone would dim and lock its screen part way through a song with nothing touched
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    let released = false
    const request = async () => {
      try {
        const sentinel = await navigator.wakeLock?.request('screen')
        if (released) {
          await sentinel?.release()
        } else {
          lock = sentinel ?? null
        }
      } catch {
        // Not allowed (battery saver, an older browser): the screen may dim
      }
    }
    if (playing) {
      void request()
    }
    return () => {
      released = true
      void lock?.release()
    }
  }, [playing])

  return { active, pause, play, playing, reached, seek, time }
}
