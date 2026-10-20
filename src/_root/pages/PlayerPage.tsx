import { useAtom, useAtomValue } from 'jotai'
import { RotateCcwClockIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'

import PlayerRail from '@/components/lyrics-display/PlayerRail'
import VersionPreviewBanner, {
  parsePreviewVersion,
} from '@/components/lyrics-display/VersionPreviewBanner'
import { PlayerStage } from '@/components/player-stage/PlayerStage'
import { StageLyrics } from '@/components/player-stage/StageLyrics'
import { DEFAULT_YOUTUBE_QUIRKS } from '@/components/player-stage/youtubeQuirks'
import { useToast } from '@/components/ui/use-toast'
import { currentVideoAtom, showWatchHistoryToastAtom } from '@/context/atoms'
import { useLyricsReady } from '@/hooks/useLyricsReady'
import { useSongVisit } from '@/hooks/useSongVisit'
import { handleVideoRoute } from '@/utils/routeHandler.ts'

const PlayerPage = () => {
  const navigate = useNavigate()
  const { videoId = '' } = useParams<{ videoId: string }>()
  const [searchParams] = useSearchParams()
  const previewVersion = parsePreviewVersion(searchParams.get('version'))

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stageVideoId, setStageVideoId] = useState<string | null>(null)

  useSongVisit(videoId)
  const currentVideo = useAtomValue(currentVideoAtom)
  // Autoplay waits for the lyrics so a song that starts singing at once never
  // plays ahead of them; useLyricsReady gives up after LYRICS_WAIT_MS
  const lyricsReady = useLyricsReady(videoId)

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
          setStageVideoId(id)
        }
      },
      onSuccess: () => {},
    })
    return () => {
      mounted = false
    }
  }, [videoId, navigate])

  const handleFirstPlay = useCallback(() => {
    if (!showWatchHistoryToast) {
      return
    }
    const handleToastDismiss = () => {
      setShowWatchHistoryToast(false)
      if (toastIdRef.current !== null) {
        dismiss(toastIdRef.current)
      }
    }
    const { id } = toast({
      title: (
        <span className='flex items-center gap-2'>
          <RotateCcwClockIcon className='size-4 shrink-0 text-primary' />
          Added to Watch History
        </span>
      ),
      description: (
        <button
          type='button'
          className='pl-6 text-white/60 underline-offset-2 hover:text-white hover:underline'
          onClick={handleToastDismiss}>
          Don't Show Again
        </button>
      ),
      duration: 2800,
    })
    toastIdRef.current = id
  }, [dismiss, setShowWatchHistoryToast, showWatchHistoryToast, toast])

  if (error !== null && error !== '') {
    return (
      <div className='flex h-dvh w-full flex-col items-center justify-center gap-4 px-4 text-center'>
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

  if (isLoading || stageVideoId === null) {
    return (
      <div className='flex h-dvh w-full items-center justify-center'>
        Loading...
      </div>
    )
  }

  return (
    <>
      <title>{`${currentVideo?.title ?? 'Player Page'} | Synbox`}</title>
      <PlayerRail />
      <VersionPreviewBanner videoId={stageVideoId} />
      <PlayerStage
        key={stageVideoId}
        videoId={stageVideoId}
        quirks={DEFAULT_YOUTUBE_QUIRKS}
        autoplay={lyricsReady}
        onFirstPlay={handleFirstPlay}
        renderLyrics={(player, layout) => (
          <StageLyrics
            videoId={stageVideoId}
            player={player}
            layout={layout}
            version={previewVersion}
          />
        )}
      />
    </>
  )
}

export default PlayerPage
