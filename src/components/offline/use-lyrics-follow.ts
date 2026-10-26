import type { TouchEvent } from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

// A finger has to travel this far before the lyrics count as scrolled by hand: a resting thumb or a tap that
// rolls a little is not a scroll
const BROWSE_SLOP_PX = 10
// After this long without a touch or a scroll, a playing song takes the lyrics back to the line being sung
const RESUME_AFTER_MS = 4000

// Where reading stood: a line and how far its top sat below the box's top. Kept so a change in what each line
// shows (the Lyrics, Romaji and Translation toggles) leaves the same line in the same place
interface ReadingPlace {
  index: number
  offset: number
}

const readingPlace = (
  box: HTMLElement,
  blocks: readonly (HTMLElement | null)[]
): ReadingPlace | null => {
  // The first line that starts in view; failing that, the one running into view from above
  const { top } = box.getBoundingClientRect()
  let partly: ReadingPlace | null = null
  for (const [index, block] of blocks.entries()) {
    const rect = block?.getBoundingClientRect()
    if (rect !== undefined && rect.top >= top) {
      return { index, offset: rect.top - top }
    }
    if (rect !== undefined && rect.bottom > top && partly === null) {
      partly = { index, offset: rect.top - top }
    }
  }
  return partly
}

// Calls `onResize` whenever one of the elements changes size; returns the cleanup
const observeSize = (elements: Element[], onResize: () => void) => {
  const observer = new ResizeObserver(onResize)
  for (const element of elements) {
    observer.observe(element)
  }
  return () => {
    observer.disconnect()
  }
}

interface LyricsFollowOptions {
  // The line to keep in view: the one being sung, or the last one reached through an instrumental gap
  target: number
  // Synced lyrics only; plain lyrics never follow anything
  enabled: boolean
  // How far down the box the followed line sits, as a share of its height
  followAt: number
  // Instead of followAt: the line's middle in the box's middle, or its top at the box's top when it is taller
  centred?: boolean
  // Whether a playing song takes the box back by itself after a while; without, only Current Line or a seek does
  resumes?: boolean
  isPlaying: () => boolean
  // How long the glide to the next line takes, in ms: the caller sizes it to the line, so a fast song's glide
  // ends before the next line comes
  glideMs?: number
}

// The browser's own smooth scroll moves one line in about 120 ms on WebKit, a jump rather than a glide
const GLIDE_MS = 450

const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2

// A box of lyrics that follows the song: the followed line glides to `followAt` as the song moves on. A real
// scroll by hand (a finger moved past the slop, or a wheel) lets the viewer read elsewhere; four seconds
// after they stop, a playing song takes the box back, and Current Line or a seek does at once. When the rows
// change height (`content` resizes), the line being read stays where it was
export const useLyricsFollow = <Content extends HTMLElement = HTMLDivElement>({
  target,
  enabled,
  followAt,
  centred = false,
  resumes = true,
  isPlaying,
  glideMs = GLIDE_MS,
}: LyricsFollowOptions) => {
  const [following, setFollowing] = useState(true)
  const followingRef = useRef(following)
  useLayoutEffect(() => {
    followingRef.current = following
  })
  const scroller = useRef<HTMLDivElement>(null)
  const blocks = useRef<(HTMLDivElement | null)[]>([])
  // The running glide's animation frame, stopped by a new target, a jump or the viewer's own scroll
  const glide = useRef<number | null>(null)
  const stopGlide = useCallback(() => {
    if (glide.current !== null) {
      cancelAnimationFrame(glide.current)
      glide.current = null
    }
  }, [])
  useEffect(() => stopGlide, [stopGlide])

  const scrollToTarget = useCallback(
    (behavior: ScrollBehavior) => {
      const box = scroller.current
      const block = blocks.current[target]
      if (box === null || block === undefined || block === null) {
        return
      }
      stopGlide()
      const offset = centred
        ? Math.max(0, (box.clientHeight - block.offsetHeight) / 2)
        : box.clientHeight * followAt
      const from = box.scrollTop
      const to = Math.min(
        Math.max(
          0,
          from +
            block.getBoundingClientRect().top -
            box.getBoundingClientRect().top -
            offset
        ),
        box.scrollHeight - box.clientHeight
      )
      if (
        behavior !== 'smooth' ||
        Math.abs(to - from) < 1 ||
        matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        box.scrollTo({ behavior: 'instant', top: to })
        return
      }
      // Eased in and out over glideMs; each step is instant, or the page's smooth scroll-behavior would chase it
      const startedAt = performance.now()
      const step = (now: number) => {
        const t = Math.min(1, (now - startedAt) / glideMs)
        box.scrollTo({
          behavior: 'instant',
          top: from + (to - from) * easeInOut(t),
        })
        glide.current = t < 1 ? requestAnimationFrame(step) : null
      }
      glide.current = requestAnimationFrame(step)
    },
    [target, followAt, centred, glideMs, stopGlide]
  )

  useEffect(() => {
    if (enabled && following) {
      scrollToTarget('smooth')
    }
  }, [enabled, following, scrollToTarget])

  // Rows that grew or shrank (the show toggles, fonts and furigana settling), or a box that did (the watch page's
  // lyrics expanding): the followed line jumps straight back to its place, or the line being read elsewhere stays put. A resize is seen before paint, so the
  // move never is
  const place = useRef<ReadingPlace | null>(null)
  const scrollToTargetRef = useRef(scrollToTarget)
  useLayoutEffect(() => {
    scrollToTargetRef.current = scrollToTarget
  })
  const content = useRef<Content>(null)
  useLayoutEffect(() => {
    const keepPlace = () => {
      const box = scroller.current
      if (box === null) {
        return
      }
      if (followingRef.current) {
        scrollToTargetRef.current('instant')
        return
      }
      const saved = place.current
      const block = saved === null ? null : blocks.current[saved.index]
      if (saved !== null && block !== null && block !== undefined) {
        // Instant: the page's smooth scroll-behavior would otherwise animate it
        box.scrollBy({
          behavior: 'instant',
          top:
            block.getBoundingClientRect().top -
            box.getBoundingClientRect().top -
            saved.offset,
        })
      }
    }
    const rows = content.current
    const box = scroller.current
    return enabled && rows !== null && box !== null
      ? observeSize([rows, box], keepPlace)
      : undefined
  }, [enabled])

  const touchY = useRef<number | null>(null)
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )
  const isPlayingRef = useRef(isPlaying)
  useEffect(() => {
    isPlayingRef.current = isPlaying
  })
  const armResume = useCallback(() => {
    clearTimeout(resumeTimer.current)
    if (!resumes) {
      return
    }
    resumeTimer.current = setTimeout(function resume() {
      // A finger still on the lyrics, or a paused song: try again later
      if (touchY.current !== null || !isPlayingRef.current()) {
        resumeTimer.current = setTimeout(resume, RESUME_AFTER_MS)
        return
      }
      setFollowing(true)
    }, RESUME_AFTER_MS)
  }, [resumes])
  useEffect(
    () => () => {
      clearTimeout(resumeTimer.current)
    },
    []
  )

  const browse = () => {
    // The viewer's own scroll wins over a glide still running
    stopGlide()
    if (enabled) {
      setFollowing(false)
      armResume()
    }
  }
  const follow = useCallback(() => {
    clearTimeout(resumeTimer.current)
    setFollowing(true)
  }, [])

  const handlers = {
    onScroll: () => {
      const box = scroller.current
      // No lines shown (all toggled off) keeps the place they had
      const now = box === null ? null : readingPlace(box, blocks.current)
      if (now !== null) {
        place.current = now
      }
      // Momentum after the finger lifts is still the viewer's scroll
      if (!followingRef.current) {
        armResume()
      }
    },
    onTouchEnd: () => {
      touchY.current = null
    },
    onTouchMove: (event: TouchEvent) => {
      const start = touchY.current
      const y = event.touches[0]?.clientY
      if (
        followingRef.current &&
        start !== null &&
        y !== undefined &&
        Math.abs(y - start) > BROWSE_SLOP_PX
      ) {
        browse()
      }
    },
    onTouchStart: (event: TouchEvent) => {
      touchY.current = event.touches[0]?.clientY ?? null
    },
    onWheel: browse,
  }
  return {
    blocks,
    // The element around the rows, whose size changing re-places the scroll
    content,
    follow,
    following,
    handlers: { ...handlers, onTouchCancel: handlers.onTouchEnd },
    scroller,
  }
}
