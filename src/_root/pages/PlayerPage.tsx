import { useAtom, useAtomValue } from 'jotai'
import { RotateCcwClockIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import LyricsDisplayOverlay from '@/components/lyrics-display/LyricsDisplayOverlay'
import LyricsVisibilityToggleGroup from '@/components/lyrics-display/LyricsVisibilityToggleGroup'
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
  translationVisibilityAtom,
} from '@/context/atoms'
import { showWatchHistoryToastAtom } from '@/context/atoms'
import { handleVideoRoute } from '@/utils/routeHandler.ts'

const PlayerPage = () => {
  const navigate = useNavigate()
  const { videoId } = useParams<{ videoId: string }>()
  const { volume, playerOverlayVisibleHandler } = useAppContext()

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

  const [muted, setMuted] = useAtom(mutedAtom)
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

  const handlePlayPause = useCallback(() => {
    const newPlayingState = !playing
    setPlaying(newPlayingState)
    setLyricsControlVisibility(!newPlayingState)
  }, [playing, setLyricsControlVisibility])

  const handlePlay = useCallback(() => {
    setPlaying(true)
    if (muted) {
      setMuted(false)
    }
    setLyricsControlVisibility(false)
  }, [muted, setMuted, setLyricsControlVisibility])

  const handleInitMutedPlay = useCallback(() => {
    setMuted(false)
    playerOverlayVisibleHandler.close()
    handlePlay()
    setLyricsControlVisibility(false)

    const handleToastDismiss = () => {
      setShowWatchHistoryToast(false)
      if (toastIdRef.current) {
        dismiss(toastIdRef.current)
      }
    }

    if (showWatchHistoryToast) {
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
    }
  }, [
    setLyricsControlVisibility,
    handlePlay,
    playerOverlayVisibleHandler,
    dismiss,
    setShowWatchHistoryToast,
    setMuted,
    toast,
    showWatchHistoryToast,
  ])

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

      {isPlayerReady && (
        <LyricsDisplayOverlay
          playerRef={playerRef}
          lyricsVisibility={lyricsVisibility}
          romajiVisibility={romajiVisibility}
          translationVisibility={translationVisibility}
          playing={playing}
        />
      )}

      <div className='relative aspect-video h-full w-full border-none'>
        {stateVideoId && (
          <VideoPlayer
            videoId={stateVideoId}
            playerRef={playerRef}
            loop={false}
            playing={playing}
            volume={volume}
            handleInitMutedPlay={handleInitMutedPlay}
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
