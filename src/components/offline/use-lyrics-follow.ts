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

// Calls `onResize` whenever the element changes size; returns the cleanup
const observeSize = (element: Element, onResize: () => void) => {
  const observer = new ResizeObserver(onResize)
  observer.observe(element)
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
  isPlaying: () => boolean
}

// A box of lyrics that follows the song: the followed line glides to `followAt` as the song moves on. A real
// scroll by hand (a finger moved past the slop, or a wheel) lets the viewer read elsewhere; four seconds
// after they stop, a playing song takes the box back, and Current Line or a seek does at once. When the rows
// change height (`content` resizes), the line being read stays where it was
export const useLyricsFollow = <Content extends HTMLElement = HTMLDivElement>({
  target,
  enabled,
  followAt,
  isPlaying,
}: LyricsFollowOptions) => {
  const [following, setFollowing] = useState(true)
  const followingRef = useRef(following)
  useLayoutEffect(() => {
    followingRef.current = following
  })
  const scroller = useRef<HTMLDivElement>(null)
  const blocks = useRef<(HTMLDivElement | null)[]>([])

  const scrollToTarget = useCallback(
    (behavior: ScrollBehavior) => {
      const box = scroller.current
      const block = blocks.current[target]
      if (box === null || block === undefined || block === null) {
        return
      }
      box.scrollTo({
        behavior:
          behavior === 'smooth' &&
          matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : behavior,
        top:
          box.scrollTop +
          block.getBoundingClientRect().top -
          box.getBoundingClientRect().top -
          box.clientHeight * followAt,
      })
    },
    [target, followAt]
  )

  useEffect(() => {
    if (enabled && following) {
      scrollToTarget('smooth')
    }
  }, [enabled, following, scrollToTarget])

  // Rows that grew or shrank (the show toggles, fonts and furigana settling): the followed line jumps straight
  // back to its place, or the line being read elsewhere stays put. A resize is seen before paint, so the
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
    return enabled && rows !== null ? observeSize(rows, keepPlace) : undefined
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
    resumeTimer.current = setTimeout(function resume() {
      // A finger still on the lyrics, or a paused song: try again later
      if (touchY.current !== null || !isPlayingRef.current()) {
        resumeTimer.current = setTimeout(resume, RESUME_AFTER_MS)
        return
      }
      setFollowing(true)
    }, RESUME_AFTER_MS)
  }, [])
  useEffect(
    () => () => {
      clearTimeout(resumeTimer.current)
    },
    []
  )

  const browse = () => {
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
