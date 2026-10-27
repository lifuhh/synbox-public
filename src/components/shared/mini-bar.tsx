import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { RefObject } from 'react'
import { useNavigate } from 'react-router'

import {
  connectEngine,
  floatEngine,
  glideEngine,
  heldSong,
  loadSong,
} from '@/components/player-stage/youtube-engine'
import { DEFAULT_YOUTUBE_QUIRKS } from '@/components/player-stage/youtube-quirks'
import { playerVolumeAtom } from '@/context/atoms'
import { useSongPresence } from '@/lib/library/presence'
import { addToHistoryAtom, historyAtom } from '@/lib/library/store'
import type { ListSong } from '@/lib/listening/model'
import { followSong, leftSong, nextSong } from '@/lib/listening/model'
import { useNextList } from '@/lib/listening/recommendations'
import {
  autoplayAtom,
  contextAtom,
  playedAtom,
  queueAtom,
  resumeSongAtom,
  songPath,
  songState,
} from '@/lib/listening/store'
import { countListen } from '@/lib/song-stats'
import type { YTPlayer } from '@/lib/youtube/iframe-api'
import { YTState } from '@/lib/youtube/iframe-api'

import { growFromBar } from './grow-from-bar'
import { MiniBarView, THUMB_RADIUS_PX } from './mini-bar-view'

type Phase = 'playing' | 'paused' | 'ended'

// The player's wide layout (watch-page.tsx), which has no drag to minimise to grow back along
const WIDE = '(min-width: 1000px)'

// How long YouTube takes to report an unmute it was asked for
const MUTE_READ_BACK_MS = 500

// What plays after `song` ends here, as the player page would (model › nextSong): the queue, the playlist, then
// with autoplay a recommendation. Applies the step and returns the song, or null when nothing is next
const useAdvance = (song: ListSong) => {
  const [queue, setQueue] = useAtom(queueAtom)
  const [context, setContext] = useAtom(contextAtom)
  const setPlayed = useSetAtom(playedAtom)
  const autoplay = useAtomValue(autoplayAtom)
  const history = useAtomValue(historyAtom)
  const { songs } = useNextList(song.videoId)
  return function advance() {
    const recent = history.slice(0, 20).map((item) => item.videoId)
    const next = nextSong(
      { autoplay, context, queue },
      song.videoId,
      songs,
      recent,
      false
    )
    if (next === null) {
      return null
    }
    setQueue(next.queue)
    // As the player page's own step: a song of the playlist keeps it, any other ends it (model › followSong)
    setContext(
      followSong(next.context, next.song.videoId, next.context === context)
    )
    setPlayed((played) => leftSong(played, song))
    return next.song
  }
}

// A song started here, not on its page, is a listen and goes in the history as the page would have done
const useListenHere = (song: ListSong, startedHere: boolean) => {
  const presence = useSongPresence(song.videoId)
  const addToHistory = useSetAtom(addToHistoryAtom)
  const inLibrary = presence.kind === 'in-library'
  useEffect(() => {
    if (startedHere && inLibrary) {
      countListen(song.videoId)
      addToHistory(song)
    }
  }, [startedHere, inLibrary, song, addToHistory])
}

// A computed `scale` ('none' or one number) as a number
const scaleOf = (value: string | null | undefined) => {
  const scale = Number(value)
  return value !== null &&
    value !== undefined &&
    value !== '' &&
    Number.isFinite(scale)
    ? scale
    : 1
}

// The bar zooms with the tabs when the top bar's state flips: the whole dock scales, as one CSS transition
// (globals.css). The video, laid over the thumbnail from outside the dock, glides along with the same timing
// (youtube-engine › glideEngine), to where the thumbnail ends: the zoom about the dock's origin, applied to where it
// is now. Read on the flip itself, the style flushed so the transition exists
const followZoom = (thumb: HTMLElement, dock: HTMLElement) => {
  const observer = new MutationObserver(() => {
    const style = getComputedStyle(dock)
    const now = scaleOf(style.scale)
    const zoom = dock
      .getAnimations()
      .find(
        (animation) =>
          animation instanceof CSSTransition &&
          animation.transitionProperty === 'scale'
      )
    const frames =
      zoom?.effect instanceof KeyframeEffect ? zoom.effect.getKeyframes() : []
    const last = frames.at(-1)?.scale
    if (zoom === undefined || typeof last !== 'string' || now === 0) {
      return
    }
    const ratio = scaleOf(last) / now
    const [ox = 0, oy = 0] = style.transformOrigin
      .split(' ')
      .map((part) => Number(part.replace('px', '')))
    const box = dock.getBoundingClientRect()
    const x = box.left + ox * now
    const y = box.top + oy * now
    const at = thumb.getBoundingClientRect()
    glideEngine(
      {
        height: at.height * ratio,
        left: x + (at.left - x) * ratio,
        top: y + (at.top - y) * ratio,
        width: at.width * ratio,
      },
      zoom
    )
  })
  observer.observe(document.documentElement, {
    attributeFilter: ['data-topbar-state'],
  })
  return () => {
    observer.disconnect()
  }
}

// The video shrunk onto the thumbnail; handing the song back to its page, it stays there until the page places it
const floatThumb = (el: HTMLElement, restoring: RefObject<boolean>) => {
  const release = floatEngine(el, THUMB_RADIUS_PX)
  return () => {
    release({ keepShown: restoring.current })
  }
}

// The installed app's mini player, above the tabs: the song left on the player page goes on here. Its picture is
// the video itself while it plays (the one YouTube player, laid over it: youtube-engine), the still thumbnail
// otherwise, since a paused embed draws YouTube's own overlays. A line along its foot is the song's progress.
// Tapping it goes back to the player, the song going on where it is; when it ends, the next one plays here
const MiniPlayer = ({
  song,
  onClose,
}: {
  song: ListSong
  onClose: () => void
}) => {
  const setSong = useSetAtom(resumeSongAtom)
  const navigate = useNavigate()
  const held = heldSong()
  const [phase, setPhase] = useState<Phase>(
    held?.videoId === song.videoId && held.state !== YTState.Paused
      ? 'playing'
      : 'paused'
  )
  const [startedHere, setStartedHere] = useState(false)
  const player = useRef<YTPlayer | null>(null)
  const playWhenCued = useRef(false)
  const restoring = useRef(false)
  const thumb = useRef<HTMLSpanElement>(null)
  const line = useRef<HTMLSpanElement>(null)
  // Landing from the drag to minimise, the bar's stand-in was already showing in its place: no fade in. Marked once,
  // before paint, so the flag clearing later doesn't start the fade then (globals.css)
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (
      box.current !== null &&
      'minimised' in document.documentElement.dataset
    ) {
      box.current.dataset.landed = ''
    }
  }, [])

  const advance = useAdvance(song)
  useListenHere(song, startedHere)
  // The song is over (YouTube's end, or the guard's stop just before it): the next one plays here, if any
  const stoppedByGuard = useRef(false)
  const finish = () => {
    const next = advance()
    if (next === null) {
      setPhase('ended')
      return
    }
    setSong(next)
    setStartedHere(true)
    playWhenCued.current = true
    loadSong(next.videoId)
  }
  const latest = useRef({ finish })
  useLayoutEffect(() => {
    latest.current = { finish }
  })

  // A song that plays muted here (the browser refused sound when it started, or the listener muted it on the
  // player) shows Unmute: the press is the permission the browser waits for, as the stage's Tap to Unmute. The saved
  // volume follows, so the player agrees when the bar is tapped
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useAtom(playerVolumeAtom)
  // YouTube answers a little later, so the button goes at once and its state is read back after
  const unmute = () => {
    player.current?.unMute()
    setVolume({ ...volume, muted: false })
    setMuted(false)
    setTimeout(() => {
      setMuted(player.current?.isMuted() ?? false)
    }, MUTE_READ_BACK_MS)
  }

  useEffect(() => {
    const disconnect = connectEngine({
      onAutoplayBlocked: () => {
        setPhase('paused')
      },
      onError: () => {
        setPhase('paused')
      },
      onReady: (ready) => {
        player.current = ready
        setMuted(ready.isMuted())
      },
      onStateChange: (state) => {
        setMuted(player.current?.isMuted() ?? false)
        if (state === YTState.Cued && playWhenCued.current) {
          playWhenCued.current = false
          player.current?.playVideo()
        } else if (state === YTState.Playing || state === YTState.Buffering) {
          setPhase('playing')
        } else if (state === YTState.Paused) {
          if (stoppedByGuard.current) {
            stoppedByGuard.current = false
            return
          }
          setPhase('paused')
        } else if (state === YTState.Ended) {
          latest.current.finish()
        }
      },
    })
    return () => {
      disconnect({ keepPlaying: restoring.current })
    }
  }, [])

  // The video over the thumbnail while it plays
  const playing = phase === 'playing'
  useLayoutEffect(() => {
    const el = thumb.current
    return playing && el !== null ? floatThumb(el, restoring) : undefined
  }, [playing])
  useEffect(() => {
    const el = thumb.current
    const dock = el?.closest<HTMLElement>('[data-tabbar-root]')
    return el && dock ? followZoom(el, dock) : undefined
  }, [])

  // The progress line, written straight to its transform each frame while the song plays
  useEffect(() => {
    let frame = 0
    const draw = () => {
      const p = player.current
      const duration = p?.getDuration() ?? 0
      const ours = heldSong()?.videoId === song.videoId
      let progress = phase === 'ended' ? 1 : 0
      if (p !== null && ours && duration > 0) {
        const time = p.getCurrentTime()
        progress = time / duration
        // Stopped a moment before the end, as the stage is, so YouTube's end screen never shows in the thumbnail
        if (playing && time >= duration - DEFAULT_YOUTUBE_QUIRKS.endGuardSec) {
          stoppedByGuard.current = true
          p.pauseVideo()
          latest.current.finish()
          return
        }
      }
      line.current?.style.setProperty('scale', `${progress} 1`)
      if (playing) {
        frame = requestAnimationFrame(draw)
      }
    }
    draw()
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [playing, phase, song.videoId])

  const toggle = () => {
    const p = player.current
    if (playing) {
      p?.pauseVideo()
      return
    }
    if (phase !== 'ended' && heldSong()?.videoId === song.videoId) {
      p?.playVideo()
      return
    }
    // Ended, or never loaded into the player: from the start
    playWhenCued.current = true
    loadSong(song.videoId)
  }

  return (
    <div ref={box} data-resume-box>
      <MiniBarView
        song={song}
        playing={playing}
        ended={phase === 'ended'}
        muted={muted}
        thumbRef={thumb}
        lineRef={line}
        onOpen={(event) => {
          restoring.current = heldSong()?.videoId === song.videoId
          // The player the drag to minimise works on (watch-page.tsx: not wide) grows back out of this bar, starting
          // on the tap; a new tab or window opens the link as it is
          const el = thumb.current
          if (
            el === null ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            matchMedia(WIDE).matches
          ) {
            return
          }
          event.preventDefault()
          // In a transition, so React renders the player page in slices between the grow's frames
          growFromBar(el, () => {
            startTransition(() => {
              void navigate(songPath(song.videoId), {
                state: songState(song.videoId, 'resume'),
              })
            })
          })
        }}
        onToggle={toggle}
        onUnmute={unmute}
        onClose={() => {
          if (heldSong()?.videoId === song.videoId) {
            player.current?.pauseVideo()
          }
          onClose()
        }}
      />
    </div>
  )
}

const MiniBar = () => {
  const [song, setSong] = useAtom(resumeSongAtom)
  if (song === null) {
    return null
  }
  return (
    <MiniPlayer
      song={song}
      onClose={() => {
        setSong(null)
      }}
    />
  )
}

export default MiniBar
