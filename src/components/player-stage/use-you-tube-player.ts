import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'

import { linkStartTime } from '@/lib/start-time'
import type { YTPlayer, YTStateCode } from '@/lib/youtube/iframe-api'
import { YTState } from '@/lib/youtube/iframe-api'

import { holdReading, NO_READING } from './player-reading'
import { clampSeek } from './seek-steps'
import {
  connectEngine,
  heldSong,
  loadSong,
  placeEngine,
  rebuildEngine,
} from './youtube-engine'
import type { YouTubeQuirks } from './youtube-quirks'

export type StagePhase =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'starting' }
  // Unsettled while the cover is held after a resume (quirks.coverHoldMs)
  | { kind: 'playing'; settled: boolean }
  | { kind: 'buffering' }
  | { kind: 'paused' }
  | { kind: 'ended' }
  | { kind: 'error'; code: number }

export interface PlayerVolume {
  level: number
  muted: boolean
}

interface UseYouTubePlayerOptions {
  videoId: string
  quirks: YouTubeQuirks
  volume: PlayerVolume
  loop: boolean
  onEvent?: (message: string) => void
  // The browser refused to start the song with sound, so it plays muted
  onBlocked?: () => void
}

const heldPhase = (state: YTStateCode): StagePhase => {
  if (state === YTState.Playing) {
    return { kind: 'playing', settled: true }
  }
  return state === YTState.Buffering
    ? { kind: 'buffering' }
    : { kind: 'paused' }
}

// How long after a song comes back from the mini bar a pause it didn't ask for is undone
const CARRIED_ON_MS = 1500

// YouTube's own mute and volume against the control's, read back once YouTube has had time to apply a change.
// `mute`/`level`: sound the control doesn't show (or the wrong level), so the control's setting is applied again.
// `blocked`: silent while the control shows sound and the song plays, as when the browser kept it muted; the
// control then shows it muted, with Tap to Unmute. A paused song makes no sound, so a silent one waits for its play
export type VolumeDrift = 'none' | 'mute' | 'level' | 'blocked'
export const volumeDrift = (
  want: PlayerVolume,
  heard: { muted: boolean; volume: number },
  playing: boolean
): VolumeDrift => {
  if (heard.muted !== want.muted) {
    if (!heard.muted) {
      return 'mute'
    }
    return playing ? 'blocked' : 'none'
  }
  if (
    !want.muted &&
    Math.abs(heard.volume - Math.round(want.level * 100)) > 1
  ) {
    return 'level'
  }
  return 'none'
}
// How long YouTube takes to report a mute or volume it was asked for
const VERIFY_MS = 500
// While a song plays the check also runs on its own, for any change no event announced (YouTube's own)
const VERIFY_EVERY_MS = 2000
// Re-applying the control's setting more often than this means YouTube won't take it; it is left to the next change
const VERIFY_TRIES = 3

// A play YouTube has not answered at all by then: no buffering, no playing, no refusal
const START_CHECK_MS = 1500

const STATE_NAMES: Record<YTStateCode, string> = {
  [YTState.Unstarted]: 'UNSTARTED',
  [YTState.Ended]: 'ENDED',
  [YTState.Playing]: 'PLAYING',
  [YTState.Paused]: 'PAUSED',
  [YTState.Buffering]: 'BUFFERING',
  [YTState.Cued]: 'CUED',
}

const nextPhase = (
  current: StagePhase,
  state: YTStateCode,
  stoppedByGuard: boolean
): StagePhase => {
  // Until the song asked for is cued, what YouTube reports is about the one before
  if (current.kind === 'loading' && state !== YTState.Cued) {
    return current
  }
  switch (state) {
    case YTState.Playing: {
      // Resuming from a pause has no cover to hold
      const resuming =
        current.kind !== 'playing' &&
        current.kind !== 'buffering' &&
        current.kind !== 'paused'
      return { kind: 'playing', settled: !resuming }
    }
    case YTState.Buffering: {
      return current.kind === 'ready' || current.kind === 'starting'
        ? { kind: 'starting' }
        : { kind: 'buffering' }
    }
    case YTState.Paused: {
      return stoppedByGuard ? { kind: 'ended' } : { kind: 'paused' }
    }
    case YTState.Ended: {
      return { kind: 'ended' }
    }
    case YTState.Cued: {
      return { kind: 'ready' }
    }
    case YTState.Unstarted: {
      return current
    }
    default: {
      return current
    }
  }
}

export const useYouTubePlayer = ({
  videoId,
  quirks,
  volume,
  loop,
  onEvent,
  onBlocked,
}: UseYouTubePlayerOptions) => {
  const stageRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  // A song the player already holds (back from the mini bar) goes on from where it is, as it is (loadSong keeps it)
  const [phase, setPhase] = useState<StagePhase>(() => {
    const held = heldSong()
    return held?.videoId === videoId
      ? heldPhase(held.state)
      : { kind: 'loading' }
  })
  const phaseRef = useRef(phase)
  const stoppedByGuardRef = useRef(false)
  const carriedOnUntilRef = useRef(0)

  // Read inside long-lived YouTube callbacks without re-creating the player
  const latest = useRef({ loop, onBlocked, onEvent, quirks })
  useLayoutEffect(() => {
    phaseRef.current = phase
    latest.current = { loop, onBlocked, onEvent, quirks }
  })

  const log = useCallback((message: string) => {
    latest.current.onEvent?.(message)
  }, [])

  const readingRef = useRef(NO_READING)
  const read = useCallback(() => {
    const player = playerRef.current
    readingRef.current = holdReading(
      readingRef.current,
      player
        ? { duration: player.getDuration(), time: player.getCurrentTime() }
        : null
    )
    return readingRef.current
  }, [])

  const dropCaptions = useCallback((player: YTPlayer) => {
    if (!latest.current.quirks.unloadCaptions) {
      return
    }
    player.unloadModule?.('captions')
    player.unloadModule?.('cc')
  }, [])

  const volumeRef = useRef(volume)
  const applyVolume = useCallback(
    (player: YTPlayer, { level, muted }: PlayerVolume) => {
      volumeRef.current = { level, muted }
      player.setVolume(Math.round(level * 100))
      if (muted) {
        player.mute()
      } else {
        player.unMute()
      }
    },
    []
  )

  // The control must never show muted over a song that plays aloud, or the reverse: after every change and every
  // start of playback, what YouTube reports is checked against it (volumeDrift)
  const verifyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )
  const verifyTriesRef = useRef(0)
  const verifyVolume = useCallback(() => {
    const check = () => {
      const player = playerRef.current
      if (!player) {
        return
      }
      const { kind } = phaseRef.current
      const drift = volumeDrift(
        volumeRef.current,
        { muted: player.isMuted(), volume: player.getVolume() },
        kind === 'playing' || kind === 'buffering'
      )
      if (drift === 'none') {
        verifyTriesRef.current = 0
        return
      }
      log(`volume drift: ${drift}`)
      if (drift === 'blocked') {
        latest.current.onBlocked?.()
        return
      }
      verifyTriesRef.current += 1
      if (verifyTriesRef.current <= VERIFY_TRIES) {
        applyVolume(player, volumeRef.current)
        verifyTimerRef.current = setTimeout(check, VERIFY_MS)
      }
    }
    clearTimeout(verifyTimerRef.current)
    verifyTimerRef.current = setTimeout(check, VERIFY_MS)
  }, [applyVolume, log])

  const startCheckRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )
  // After a rebuild the song plays again, as it was asked to; a player is rebuilt once per song
  const replayRef = useRef<{ muted: boolean } | null>(null)
  const rebuiltRef = useRef(false)
  const silentPlayRef = useRef(false)
  // A song refused sound plays muted. One refused even muted (iOS Low Power Mode) waits for a tap
  const refusedRef = useRef<(() => void) | null>(null)

  const rebuild = useCallback((replay: { muted: boolean } | null) => {
    replayRef.current = replay
    playerRef.current = null
    setPhase({ kind: 'loading' })
    rebuildEngine(readingRef.current.time)
  }, [])

  // `muted` mutes YouTube before asking it to play: browsers only allow an
  // autoplay without a user gesture when it is silent
  const play = useCallback(
    ({ muted: silent = false }: { muted?: boolean } = {}) => {
      const player = playerRef.current
      if (!player) {
        return
      }
      if (silent) {
        player.mute()
      }
      if (phaseRef.current.kind === 'ended') {
        player.seekTo(0, true)
      }
      if (phaseRef.current.kind === 'ready') {
        setPhase({ kind: 'starting' })
      }
      silentPlayRef.current = silent
      player.playVideo()
      // A refused play usually comes with onAutoplayBlocked; one with no answer at all counts as refused,
      // and a silent one with no answer means the embed hangs (after another app's audio cut in)
      clearTimeout(startCheckRef.current)
      startCheckRef.current = setTimeout(() => {
        if (!silent) {
          log('start check: no answer')
          refusedRef.current?.()
        } else if (!rebuiltRef.current) {
          rebuiltRef.current = true
          log('start check: no answer, rebuilding')
          rebuild({ muted: true })
        }
      }, START_CHECK_MS)
    },
    [log, rebuild]
  )

  useLayoutEffect(() => {
    refusedRef.current = () => {
      if (silentPlayRef.current) {
        setPhase((current) =>
          current.kind === 'starting' ? { kind: 'ready' } : current
        )
        return
      }
      latest.current.onBlocked?.()
      play({ muted: true })
    }
  })

  useEffect(() => {
    const settle = () => {
      setPhase((current) =>
        current.kind === 'playing'
          ? { kind: 'playing', settled: true }
          : current
      )
    }
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    // A song going on from the mini bar that YouTube pauses by itself straight away (WebKit stops a muted autoplay
    // when the video moves to its stage) plays on: the listener never asked for that pause
    const held = heldSong()
    carriedOnUntilRef.current =
      held?.videoId === videoId && held.state === YTState.Playing
        ? performance.now() + CARRIED_ON_MS
        : 0
    const disconnect = connectEngine({
      onAutoplayBlocked: () => {
        clearTimeout(startCheckRef.current)
        log('autoplay blocked')
        refusedRef.current?.()
      },
      onError: (code) => {
        clearTimeout(startCheckRef.current)
        log(`error ${code}`)
        setPhase({ code, kind: 'error' })
      },
      onReady: (player) => {
        playerRef.current = player
        // A song going on from the mini bar that YouTube plays muted (sound was refused) stays muted: unmuting it
        // without a tap stops it. The stage offers the tap instead
        if (
          heldSong()?.videoId === videoId &&
          player.isMuted() &&
          !volumeRef.current.muted
        ) {
          latest.current.onBlocked?.()
        } else {
          applyVolume(player, volumeRef.current)
        }
        verifyVolume()
        dropCaptions(player)
        log('ready')
      },
      onStateChange: (state) => {
        const player = playerRef.current
        log(`state ${STATE_NAMES[state] ?? state}`)
        if (
          state === YTState.Paused &&
          performance.now() < carriedOnUntilRef.current
        ) {
          carriedOnUntilRef.current = 0
          player?.playVideo()
          return
        }
        if (state === YTState.Buffering || state === YTState.Playing) {
          clearTimeout(startCheckRef.current)
        }
        if (state === YTState.Playing && player) {
          verifyVolume()
          stoppedByGuardRef.current = false
          dropCaptions(player)
          clearTimeout(settleTimer)
          settleTimer = setTimeout(settle, latest.current.quirks.coverHoldMs)
        }
        setPhase((current) =>
          nextPhase(current, state, stoppedByGuardRef.current)
        )
        const replay = replayRef.current
        if (state === YTState.Cued && replay) {
          replayRef.current = null
          play(replay)
        }
      },
    })
    // A link with `?t=` starts the song there, as YouTube's do
    loadSong(videoId, linkStartTime() ?? 0)
    return () => {
      clearTimeout(settleTimer)
      clearTimeout(startCheckRef.current)
      clearTimeout(verifyTimerRef.current)
      playerRef.current = null
      disconnect()
    }
  }, [videoId, applyVolume, dropCaptions, log, play, verifyVolume])

  // The video lies over this stage's box. YouTube's own error screens (unavailable, sign-in, age gate)
  // need its UI, so they take input
  const blockInput = quirks.blockIframeInput && phase.kind !== 'error'
  const { cropPx } = quirks
  useLayoutEffect(() => {
    const stage = stageRef.current
    const box = boxRef.current
    return stage && box
      ? placeEngine(stage, box, { blockInput, cropPx })
      : undefined
  }, [blockInput, cropPx])

  // A phone suspends the page, and the embed with it, once the app leaves the screen: the song pauses
  // there and waits, at the same time, on the same player
  useEffect(() => {
    const handleVisibility = () => {
      if (
        document.visibilityState === 'hidden' &&
        matchMedia('(pointer: coarse)').matches
      ) {
        clearTimeout(startCheckRef.current)
        playerRef.current?.pauseVideo()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  // An embed that couldn't load without a connection (still loading, or YouTube's error) is built again
  // once the phone is back online; a player that loaded is left
  useEffect(() => {
    const handleOnline = () => {
      const { kind } = phaseRef.current
      if (kind === 'loading' || kind === 'error') {
        rebuild(null)
      }
    }
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('online', handleOnline)
    }
  }, [rebuild])

  const playingNow = phase.kind === 'playing'
  useEffect(() => {
    const timer = playingNow
      ? setInterval(verifyVolume, VERIFY_EVERY_MS)
      : undefined
    return () => {
      clearInterval(timer)
    }
  }, [playingNow, verifyVolume])

  // Before onReady these only record the value; onReady applies it
  const { level, muted } = volume
  useEffect(() => {
    volumeRef.current = { level, muted }
    const player = playerRef.current
    if (player) {
      applyVolume(player, { level, muted })
      verifyTriesRef.current = 0
      verifyVolume()
    }
  }, [level, muted, applyVolume, verifyVolume])

  const { unloadCaptions } = quirks
  useEffect(() => {
    const player = playerRef.current
    if (!player) {
      return
    }
    if (unloadCaptions) {
      player.unloadModule?.('captions')
      player.unloadModule?.('cc')
    } else {
      player.loadModule?.('captions')
    }
  }, [unloadCaptions])

  const frameListeners = useRef(new Set<(time: number) => void>())

  useEffect(() => {
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const player = playerRef.current
      if (!player) {
        return
      }
      const { time, duration } = read()
      const guard = latest.current.quirks.endGuardSec
      if (
        guard > 0 &&
        duration > 0 &&
        phaseRef.current.kind === 'playing' &&
        time >= duration - guard
      ) {
        if (latest.current.loop) {
          log('end guard: loop')
          player.seekTo(0, true)
        } else {
          log('end guard: stop')
          stoppedByGuardRef.current = true
          flushSync(() => {
            setPhase({ kind: 'ended' })
          })
          player.pauseVideo()
        }
      }
      for (const listener of frameListeners.current) {
        listener(time)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [log, read])

  const subscribeFrame = useCallback((listener: (time: number) => void) => {
    frameListeners.current.add(listener)
    return () => {
      frameListeners.current.delete(listener)
    }
  }, [])

  const pause = useCallback(() => {
    const player = playerRef.current
    if (!player) {
      return
    }
    carriedOnUntilRef.current = 0
    player.pauseVideo()
  }, [])

  const togglePlay = useCallback(() => {
    const { kind } = phaseRef.current
    // 'starting' is not playing yet: a click there must (re)start playback,
    // which also gives the browser the user gesture an unmuted start needs
    if (kind === 'playing' || kind === 'buffering') {
      pause()
    } else {
      play()
    }
  }, [pause, play])

  // Call inside a tap or key handler. The unmute, and a play YouTube passes straight to its <video>, reach
  // the element while the browser still counts the tap, which lets it make sound for the rest of the visit
  const unlockSound = useCallback(() => {
    const player = playerRef.current
    if (!player) {
      return
    }
    player.unMute()
    const { kind } = phaseRef.current
    if (kind === 'playing' || kind === 'buffering') {
      player.playVideo()
    }
    verifyVolume()
  }, [verifyVolume])

  const seek = useCallback(
    (seconds: number) => {
      const player = playerRef.current
      if (!player) {
        return
      }
      stoppedByGuardRef.current = false
      player.seekTo(
        clampSeek(seconds, read().duration, latest.current.quirks.endGuardSec),
        true
      )
      dropCaptions(player)
    },
    [dropCaptions, read]
  )

  const getTime = useCallback(() => read().time, [read])
  const getDuration = useCallback(() => read().duration, [read])
  return {
    boxRef,
    getDuration,
    getTime,
    pause,
    phase,
    play,
    seek,
    stageRef,
    subscribeFrame,
    togglePlay,
    unlockSound,
  }
}

export type StagePlayer = ReturnType<typeof useYouTubePlayer>
