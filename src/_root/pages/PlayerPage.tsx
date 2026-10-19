import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { RotateCcwClockIcon, VolumeXIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import LyricsDisplayOverlay from '@/components/lyrics-display/LyricsDisplayOverlay'
import LyricsVisibilityToggleGroup from '@/components/lyrics-display/LyricsVisibilityToggleGroup'
import VersionPreviewBanner from '@/components/lyrics-display/VersionPreviewBanner'
import VideoPlayer from '@/components/shared/VideoPlayer'
import type { ToastProps } from '@/components/ui/toast'
import { useToast } from '@/components/ui/use-toast'
import { useAppContext } from '@/context/AppContext'
import {
  currentVideoAtom,
  lyricsControlVisibilityAtom,
  lyricsVisibilityAtom,
  mutedAtom,
  romajiVisibilityAtom,
  showWatchHistoryToastAtom,
  translationVisibilityAtom,
} from '@/context/atoms'
import { useLyricsReady } from '@/hooks/useLyricsReady'
import { handleVideoRoute } from '@/utils/routeHandler.ts'

// How long an unmuted autoplay gets to start before falling back to muted
const AUTOPLAY_CHECK_MS = 1500

const PlayerPage = () => {
  const navigate = useNavigate()
  const { videoId } = useParams<{ videoId: string }>()
  const { volume } = useAppContext()

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stateVideoId, setStateVideoId] = useState<string | null>(null)
  const [isPlayerReady, setIsPlayerReady] = useState(false)
  const [playing, setPlaying] = useState<boolean>(false)
  // Values unread, but these subscriptions re-render VideoPlayer, which re-applies `playing` each render
  const [, setPlayed] = useState<number>(0)
  const [, setDuration] = useState<number>(0)
  const [, setLyricsControlVisibility] = useAtom(lyricsControlVisibilityAtom)

  const playerRef = useRef<HTMLVideoElement>(null)

  const setMuted = useSetAtom(mutedAtom)
  const lyricsVisibility = useAtomValue(lyricsVisibilityAtom)
  const romajiVisibility = useAtomValue(romajiVisibilityAtom)
  const translationVisibility = useAtomValue(translationVisibilityAtom)
  const currentVideo = useAtomValue(currentVideoAtom)

  const title = currentVideo && currentVideo.title

  const { toast, dismiss } = useToast()
  const toastIdRef = useRef<string | null>(null)
  const [showWatchHistoryToast, setShowWatchHistoryToast] = useAtom(
    showWatchHistoryToastAtom
  )

  useEffect(() => {
    let mounted = true

    handleVideoRoute({
      navigate,
      videoId,
      setIsLoading: (loading) => {
        if (mounted) {
          setIsLoading(loading)
        }
      },
      setError: (err) => {
        if (mounted) {
          setError(err)
        }
      },
      setStateVideoId: (id) => {
        if (mounted) {
          setStateVideoId(id)
        }
      },
      onSuccess: () => {
        if (mounted) {
          setIsPlayerReady(false)
          setPlaying(false)
          setPlayed(0)
        }
      },
    })

    return () => {
      mounted = false
    }
  }, [videoId, navigate])

  const handlePlayPause = useCallback(() => {
    const newPlayingState = !playing
    setPlaying(newPlayingState)
    setLyricsControlVisibility(!newPlayingState)
  }, [playing, setLyricsControlVisibility])

  const handlePlay = useCallback(() => {
    setPlaying(true)
    setLyricsControlVisibility(false)
  }, [setLyricsControlVisibility])

  const showWatchHistoryToastOnce = useCallback(() => {
    if (!showWatchHistoryToast) {
      return
    }
    const handleToastDismiss = () => {
      setShowWatchHistoryToast(false)
      if (toastIdRef.current) {
        dismiss(toastIdRef.current)
      }
    }
    const { id } = toast({
      title: (
        <div className='flex items-center gap-2'>
          <p>Video added to Watch History</p>
          <RotateCcwClockIcon className='h-6 w-6 shrink-0' />
        </div>
      ) as unknown as ToastProps['title'],
      description: (
        <div className='flex justify-start'>
          <button
            className='text-primary hover:underline'
            onClick={handleToastDismiss}>
            Do not show again
          </button>
        </div>
      ),
      duration: 2800,
    })
    toastIdRef.current = id
  }, [dismiss, setShowWatchHistoryToast, showWatchHistoryToast, toast])

  // Autoplay once the player and the song's lyrics are both ready, so a song
  // that starts singing at once never plays ahead of its lyrics. With sound if
  // the browser allows it (the user has interacted with the site); otherwise
  // muted, with a Tap to Unmute button rather than a blocking overlay.
  const lyricsReady = useLyricsReady(videoId ?? '')
  const [needsUnmute, setNeedsUnmute] = useState(false)
  const autoplayedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!isPlayerReady || !lyricsReady || !stateVideoId) {
      return
    }
    if (autoplayedFor.current === stateVideoId) {
      return
    }
    autoplayedFor.current = stateVideoId
    setMuted(false)
    handlePlay()
    showWatchHistoryToastOnce()
    // A blocked unmuted play() leaves the YouTube player paused without
    // always rejecting, so check the outcome instead of the promise
    const check = setTimeout(() => {
      if (playerRef.current?.paused) {
        setMuted(true)
        setNeedsUnmute(true)
      }
    }, AUTOPLAY_CHECK_MS)
    return () => {
      clearTimeout(check)
    }
  }, [
    handlePlay,
    isPlayerReady,
    lyricsReady,
    setMuted,
    showWatchHistoryToastOnce,
    stateVideoId,
  ])

  const handleUnmute = useCallback(() => {
    setMuted(false)
    setNeedsUnmute(false)
  }, [setMuted])

  const handleStart = useCallback(() => {
    setPlaying(true)
  }, [])

  const handleProgress = useCallback(() => {
    if (!playerRef.current) {
      return null
    }
    const secondsLapsed = playerRef.current.currentTime
    const curPlayed = Math.floor(parseInt(secondsLapsed.toFixed(0)))
    setPlayed(curPlayed)
  }, [])

  const handleEnded = useCallback(() => {
    setPlaying(false)
  }, [])

  const handleDuration = useCallback((duration: number) => {
    setDuration(duration)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault()
        handlePlayPause()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [handlePlayPause])

  useEffect(() => {
    const preventSpacebarScroll = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
      }
    }

    window.addEventListener('keydown', preventSpacebarScroll)
    return () => {
      window.removeEventListener('keydown', preventSpacebarScroll)
    }
  }, [])

  if (error) {
    return (
      <div className='flex h-screen flex-col items-center justify-center gap-4'>
        <p className='text-red-500'>{error}</p>
        <p className='text-sm text-gray-600'>Video ID: {videoId}</p>
        <button
          onClick={() => navigate('/')}
          className='rounded-sm bg-primary px-4 py-2 text-white transition-colors hover:bg-primary/90'>
          Return Home
        </button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className='flex h-screen items-center justify-center'>
        Loading...
      </div>
    )
  }

  return (
    <>
      <title>{`${title ? title : 'Player Page'} | Synbox`}</title>
      <LyricsVisibilityToggleGroup />
      {videoId !== undefined && <VersionPreviewBanner videoId={videoId} />}

      {isPlayerReady && (
        <LyricsDisplayOverlay
          playerRef={playerRef}
          lyricsVisibility={lyricsVisibility}
          romajiVisibility={romajiVisibility}
          translationVisibility={translationVisibility}
          playing={playing}
        />
      )}

      {needsUnmute && (
        <button
          type='button'
          onClick={handleUnmute}
          className='absolute top-4 left-1/2 z-60 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black/85'>
          <VolumeXIcon className='size-4' aria-hidden='true' />
          Tap to Unmute
        </button>
      )}

      <div className='relative aspect-video h-full w-full border-none'>
        {stateVideoId && (
          <VideoPlayer
            videoId={stateVideoId}
            playerRef={playerRef}
            loop={false}
            playing={playing}
            volume={volume}
            handlePlay={handlePlay}

            handleProgress={handleProgress}
            handleDuration={handleDuration}
            handleStart={handleStart}
            handleEnded={handleEnded}
            setIsPlayerReady={setIsPlayerReady}
          />
        )}
      </div>
    </>
  )
}

export default PlayerPage
