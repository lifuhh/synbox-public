import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'

import type { YTPlayer, YTStateCode } from '@/lib/youtube/iframeApi'
import { loadYouTubeIframeApi, YTState } from '@/lib/youtube/iframeApi'

import type { YouTubeQuirks } from './youtubeQuirks'

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
  // A pause hides the frame under our cover; otherwise the paused frame stays in view
  coverPause: boolean
  onEvent?: (message: string) => void
}

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
  stoppedByGuard: boolean,
  coverPause: boolean
): StagePhase => {
  switch (state) {
    case YTState.Playing: {
      // Resuming from an uncovered pause has no cover to hold
      const resuming =
        current.kind !== 'playing' &&
        current.kind !== 'buffering' &&
        (coverPause || current.kind !== 'paused')
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
  coverPause,
  onEvent,
}: UseYouTubePlayerOptions) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const [phase, setPhase] = useState<StagePhase>({ kind: 'loading' })
  const phaseRef = useRef(phase)
  const stoppedByGuardRef = useRef(false)

  // A phone suspends the page, and the embed with it, once the app leaves the screen: playback cannot
  // continue there, and an embed that another app's audio interrupted can come back hung. So on a touch
  // screen the player is torn down when the page hides and rebuilt, cued where it was, when it returns
  const [suspended, setSuspended] = useState(false)
  const resumeAtRef = useRef(0)
  useEffect(() => {
    const handleVisibility = () => {
      if (!matchMedia('(pointer: coarse)').matches) {
        return
      }
      if (document.visibilityState === 'hidden') {
        resumeAtRef.current = playerRef.current?.getCurrentTime() ?? 0
        setPhase({ kind: 'loading' })
        setSuspended(true)
      } else {
        setSuspended(false)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  // Read inside long-lived YouTube callbacks without re-creating the player
  const latest = useRef({ quirks, loop, coverPause, onEvent })
  useLayoutEffect(() => {
    phaseRef.current = phase
    latest.current = { quirks, loop, coverPause, onEvent }
  })

  // YouTube times its center button from PLAYING, so a command arms the mask
  // and the PLAYING that follows restarts the countdown
  const [centerMasked, setCenterMasked] = useState(false)
  const maskArmedRef = useRef(false)
  const maskTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maskCenter = useCallback((trigger: 'command' | 'playing') => {
    const ms = latest.current.quirks.centerMaskMs
    if (trigger === 'playing' && !maskArmedRef.current) {
      return
    }
    if (maskTimerRef.current) {
      clearTimeout(maskTimerRef.current)
    }
    maskArmedRef.current = ms > 0
    setCenterMasked(ms > 0)
    if (ms <= 0) {
      return
    }
    maskTimerRef.current = setTimeout(
      () => {
        maskArmedRef.current = false
        setCenterMasked(false)
      },
      trigger === 'playing' ? ms : ms * 3
    )
  }, [])

  const log = useCallback((message: string) => {
    latest.current.onEvent?.(message)
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

  useEffect(() => {
    const host = hostRef.current
    if (!host || suspended) {
      return
    }
    let disposed = false
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    const target = document.createElement('div')
    host.append(target)

    const settle = () => {
      setPhase((current) =>
        current.kind === 'playing'
          ? { kind: 'playing', settled: true }
          : current
      )
    }

    const create = async () => {
      const YT = await loadYouTubeIframeApi()
      if (disposed) {
        return
      }
      const player = new YT.Player(target, {
        videoId,
        host: 'https://www.youtube-nocookie.com',
        width: '100%',
        height: '100%',
        playerVars: {
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          iv_load_policy: 3,
          playsinline: 1,
          cc_load_policy: 0,
          hl: 'en',
          enablejsapi: 1,
          origin: window.location.origin,
          start: Math.floor(resumeAtRef.current),
        },
        events: {
          onReady: () => {
            if (disposed) {
              return
            }
            playerRef.current = player
            applyVolume(player, volumeRef.current)
            dropCaptions(player)
            log('ready')
            setPhase({ kind: 'ready' })
          },
          onStateChange: ({ data }) => {
            if (disposed) {
              return
            }
            log(`state ${STATE_NAMES[data] ?? data}`)
            if (data === YTState.Playing) {
              stoppedByGuardRef.current = false
              dropCaptions(player)
              maskCenter('playing')
              clearTimeout(settleTimer)
              settleTimer = setTimeout(
                settle,
                latest.current.quirks.coverHoldMs
              )
            }
            setPhase((current) =>
              nextPhase(
                current,
                data,
                stoppedByGuardRef.current,
                latest.current.coverPause
              )
            )
          },
          onError: ({ data }) => {
            if (disposed) {
              return
            }
            log(`error ${data}`)
            setPhase({ kind: 'error', code: data })
          },
        },
      })
    }
    void create()

    return () => {
      disposed = true
      clearTimeout(settleTimer)
      playerRef.current?.destroy()
      playerRef.current = null
      host.replaceChildren()
    }
  }, [videoId, suspended, applyVolume, dropCaptions, log, maskCenter])

  // Before onReady these only record the value; onReady applies it
  const { level, muted } = volume
  useEffect(() => {
    volumeRef.current = { level, muted }
    const player = playerRef.current
    if (player) {
      applyVolume(player, { level, muted })
    }
  }, [level, muted, applyVolume])

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
      const time = player.getCurrentTime()
      const guard = latest.current.quirks.endGuardSec
      const duration = player.getDuration()
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
  }, [log])

  const subscribeFrame = useCallback((listener: (time: number) => void) => {
    frameListeners.current.add(listener)
    return () => {
      frameListeners.current.delete(listener)
    }
  }, [])

  // `muted` mutes YouTube before asking it to play: browsers only allow an
  // autoplay without a user gesture when it is silent
  const play = useCallback(
    ({ muted = false }: { muted?: boolean } = {}) => {
      const player = playerRef.current
      if (!player) {
        return
      }
      if (muted) {
        player.mute()
      }
      if (phaseRef.current.kind === 'ended') {
        player.seekTo(0, true)
      }
      if (phaseRef.current.kind === 'ready') {
        setPhase({ kind: 'starting' })
      }
      maskCenter('command')
      player.playVideo()
    },
    [maskCenter]
  )

  const pause = useCallback(() => {
    const player = playerRef.current
    if (!player) {
      return
    }
    if (latest.current.coverPause && latest.current.quirks.coverBeforePause) {
      // Commit the cover to the DOM before YouTube starts drawing its paused UI
      flushSync(() => {
        setPhase({ kind: 'paused' })
      })
    }
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

  const seek = useCallback(
    (seconds: number) => {
      const player = playerRef.current
      if (!player) {
        return
      }
      stoppedByGuardRef.current = false
      maskCenter('command')
      player.seekTo(seconds, true)
      dropCaptions(player)
    },
    [dropCaptions, maskCenter]
  )

  const getTime = useCallback(
    () => playerRef.current?.getCurrentTime() ?? 0,
    []
  )
  const getDuration = useCallback(
    () => playerRef.current?.getDuration() ?? 0,
    []
  )
  return {
    hostRef,
    phase,
    centerMasked,
    play,
    pause,
    togglePlay,
    seek,
    getTime,
    getDuration,
    subscribeFrame,
  }
}

export type StagePlayer = ReturnType<typeof useYouTubePlayer>
