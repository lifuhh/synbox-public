import { useAtom } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'
import YouTubeVideo from 'youtube-video-element/react'

import { useAppContext } from '@/context/AppContext'
import { mutedAtom } from '@/context/atoms'
import { isValidVideoId } from '@/utils/routeHandler'

import ExternalLinkHandler from './ExternalLinkHandler'
import PlayerMutedOverlay from './PlayerMutedOverlay'

interface VideoPlayerProps {
  videoId: string
  playing: boolean
  loop: boolean
  volume: number
  handlePlay: () => void
  handleDuration: (duration: number) => void
  handleProgress: () => void
  handleStart: () => void
  handleEnded: () => void
  handleInitMutedPlay: () => void
  setIsPlayerReady: React.Dispatch<React.SetStateAction<boolean>>
  playerRef: React.RefObject<HTMLVideoElement | null>
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoId,
  loop,
  playing,
  handlePlay,
  handleEnded,
  handleStart,
  handleInitMutedPlay,
  handleDuration,
  handleProgress,
  setIsPlayerReady,
  volume,
  playerRef,
}: VideoPlayerProps) => {
  const {
    setPlayerControlsVisible,
    playerOverlayVisible,
    playerOverlayVisibleHandler,
  } = useAppContext()
  const [muted, setMuted] = useAtom(mutedAtom)
  const [isInitialized, setIsInitialized] = useState(false)
  const [videoError, setVideoError] = useState<Error | null>(null)
  const hasStartedRef = useRef(false)

  const setPlayerElement = useCallback(
    (element: HTMLVideoElement | null) => {
      playerRef.current = element
    },
    [playerRef]
  )

  // No deps on purpose: mirrors react-player, which re-applied `playing`/`volume` on every render
  useEffect(() => {
    const player = playerRef.current
    if (!player) {
      return
    }
    if (playing && player.paused) {
      void player.play()
    }
    if (!playing && !player.paused) {
      player.pause()
    }
    player.volume = volume
  })

  const handleLoadStart = () => {
    hasStartedRef.current = false
  }

  const handlePlayEvent = () => {
    if (!hasStartedRef.current) {
      hasStartedRef.current = true
      handleStart()
    }
    handlePlay()
  }

  useEffect(() => {
    if (!isValidVideoId(videoId)) {
      setVideoError(new Error('Invalid video ID'))
      return
    }
    setVideoError(null)
  }, [videoId])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>

    const showControlsTemporarily = () => {
      clearTimeout(timer)
      setPlayerControlsVisible(true)

      if (playing) {
        timer = setTimeout(() => {
          setPlayerControlsVisible(false)
        }, 3000)
      }
    }

    showControlsTemporarily()

    document.addEventListener('mousemove', showControlsTemporarily)

    return () => {
      document.removeEventListener('mousemove', showControlsTemporarily)
      clearTimeout(timer)
    }
  }, [setPlayerControlsVisible, playing])

  useEffect(() => {
    if (muted && !playing && !playerOverlayVisible && !isInitialized) {
      playerOverlayVisibleHandler.open()
    } else if (!muted) {
      playerOverlayVisibleHandler.close()
    }
  }, [
    muted,
    playing,
    playerOverlayVisible,
    playerOverlayVisibleHandler,
    isInitialized,
  ])

  const handleReady = () => {
    if (!playerRef.current) {
      return
    }

    try {
      // Before the YouTube API loads the element reports its muted attribute, so trust the atom
      const isMuted = muted
      setMuted(isMuted)
      setIsPlayerReady(true)
      setIsInitialized(true)
      setVideoError(null)

      if (!isMuted) {
        handlePlay()
      }
    } catch (error) {
      handleError(error)
    }
  }

  const handleVideoEnded = () => {
    handleEnded()
  }

  const handleError = (error: unknown) => {
    console.error('Video player error:', error)
    const mediaErrorMessage = playerRef.current?.error?.message
    setVideoError(
      error instanceof Error
        ? error
        : new Error(mediaErrorMessage || 'Video playback error')
    )
    setIsPlayerReady(false)
  }

  return (
    <>
      {(playerOverlayVisible || !!videoError) && (
        <div className='relative z-100 flex h-full w-full items-center justify-center overflow-hidden'>
          <div className='relative z-101 h-full w-full'>
            {videoError ? (
              <div className='flex flex-col items-center justify-center text-red-500'>
                <p>Error loading video</p>
                <p className='text-sm'>{videoError.message}</p>
              </div>
            ) : (
              <PlayerMutedOverlay handleInitMutedPlay={handleInitMutedPlay} />
            )}
          </div>
          <div className='absolute inset-0 z-100 rounded-[0.25rem] bg-[rgb(59_59_59/0.75)] backdrop-blur-[15px]' />
        </div>
      )}
      <ExternalLinkHandler>
        {/* Rendered directly, not via react-player's lazy wrapper, which set `config` after the embed URL was built */}
        <YouTubeVideo
          className='absolute top-0 right-0 left-0'
          ref={setPlayerElement}
          style={{ display: 'block', width: '100%', height: '100%' }}
          config={{
            rel: 0,
            hl: 'en',
            disablekb: 1,
            fs: 0,
            cc_load_policy: 0,
          }}
          src={`https://www.youtube-nocookie.com/embed/${videoId}`}
          muted={muted}
          loop={loop}
          controls
          onLoadStart={handleLoadStart}
          onLoadedMetadata={handleReady}
          onPlay={handlePlayEvent}
          onEnded={handleVideoEnded}
          onError={handleError}
          onTimeUpdate={handleProgress}
          onDurationChange={(e) => {
            handleDuration(e.currentTarget.duration)
          }}
        />
      </ExternalLinkHandler>
    </>
  )
}

export default VideoPlayer
