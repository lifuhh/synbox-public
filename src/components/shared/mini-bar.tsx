import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { PauseIcon, PlayIcon, VolumeXIcon, XIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Link } from 'react-router'

import {
  connectEngine,
  floatEngine,
  followEngine,
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
import { cn } from '@/utils/cn'

type Phase = 'playing' | 'paused' | 'ended'

// How long YouTube takes to report an unmute it was asked for
const MUTE_READ_BACK_MS = 500

// The bar's thumbnail is rounded-lg
const THUMB_RADIUS_PX = 8

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

// The bar zooms with the tab bar when the top bar's state flips (globals.css, 300ms), a transform no resize reports:
// the video follows it every frame from the flip itself, since a transition's own events come a frame late
const ZOOM_MS = 350
const followZoom = () => {
  let frame = 0
  let until = 0
  const follow = (now: number) => {
    followEngine()
    frame = now < until ? requestAnimationFrame(follow) : 0
  }
  const observer = new MutationObserver(() => {
    until = performance.now() + ZOOM_MS
    if (frame === 0) {
      followEngine()
      frame = requestAnimationFrame(follow)
    }
  })
  observer.observe(document.documentElement, {
    attributeFilter: ['data-topbar-state'],
  })
  return () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
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
  useEffect(followZoom, [])

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
    <div
      data-resume-box
      className='relative flex h-14 items-center gap-1 overflow-hidden rounded-2xl bg-popover/90 p-1.5 shadow-lg ring-1 ring-white/10 backdrop-blur-xl'>
      <Link
        to={songPath(song.videoId)}
        state={songState(song.videoId, 'resume')}
        onClick={() => {
          restoring.current = heldSong()?.videoId === song.videoId
        }}
        className='flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
        <span ref={thumb} className='aspect-video h-11 shrink-0'>
          <img
            src={song.thumbnailUrl}
            alt=''
            className='size-full rounded-lg object-cover'
          />
        </span>
        <span className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate text-sm font-medium text-foreground'>
            {song.title}
          </span>
          <span className='truncate text-xs text-muted-foreground'>
            {song.author}
          </span>
        </span>
      </Link>
      {muted && (
        <button
          type='button'
          aria-label='Unmute'
          onClick={unmute}
          className='grid size-11 shrink-0 place-items-center rounded-full text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
          <VolumeXIcon className='size-5' aria-hidden />
        </button>
      )}
      <button
        type='button'
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={toggle}
        className='grid size-11 shrink-0 place-items-center rounded-full text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
        {playing ? (
          <PauseIcon className='size-5 fill-current' aria-hidden />
        ) : (
          <PlayIcon className='size-5 fill-current' aria-hidden />
        )}
      </button>
      <button
        type='button'
        aria-label='Close Player'
        onClick={() => {
          if (heldSong()?.videoId === song.videoId) {
            player.current?.pauseVideo()
          }
          onClose()
        }}
        className='grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'>
        <XIcon className='size-5' aria-hidden />
      </button>
      <span
        aria-hidden
        className='pointer-events-none absolute inset-x-3 bottom-0 h-0.5 overflow-hidden rounded-full bg-white/15'>
        <span
          ref={line}
          className={cn(
            'block size-full origin-left scale-x-0 bg-foreground/80',
            phase === 'ended' && 'bg-foreground/40'
          )}
        />
      </span>
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
