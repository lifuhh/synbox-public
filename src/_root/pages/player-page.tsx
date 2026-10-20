import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'

import PlayerRail from '@/components/lyrics-display/player-rail'
import SharedStyleBanner from '@/components/lyrics-display/shared-style-banner'
import VersionPreviewBanner, {
  parsePreviewVersion,
} from '@/components/lyrics-display/version-preview-banner'
import { PlayerStage } from '@/components/player-stage/player-stage'
import { StageLyrics } from '@/components/player-stage/stage-lyrics'
import { DEFAULT_YOUTUBE_QUIRKS } from '@/components/player-stage/youtube-quirks'
import {
  currentVideoAtom,
  lyricsStyleSongAtom,
  showSharedLyricsStyleAtom,
} from '@/context/atoms'
import { useLyricsReady } from '@/hooks/use-lyrics-ready'
import { useSongVisit } from '@/hooks/use-song-visit'
import { decodeSharedStyle } from '@/lib/lyrics-style'
import { handleVideoRoute } from '@/utils/route-handler.ts'

const PlayerPage = () => {
  const navigate = useNavigate()
  const { videoId = '' } = useParams<{ videoId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const previewVersion = parsePreviewVersion(searchParams.get('version'))

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stageVideoId, setStageVideoId] = useState<string | null>(null)

  useSongVisit(videoId)
  const currentVideo = useAtomValue(currentVideoAtom)
  // Autoplay waits for the lyrics so a song that starts singing at once never
  // plays ahead of them; useLyricsReady gives up after LYRICS_WAIT_MS
  const lyricsReady = useLyricsReady(videoId)

  const setLyricsStyleSong = useSetAtom(lyricsStyleSongAtom)
  useEffect(() => {
    setLyricsStyleSong(stageVideoId)
    return () => {
      setLyricsStyleSong(null)
    }
  }, [stageVideoId, setLyricsStyleSong])

  // A link's ?style= is shown for this visit and then leaves the address, so a reload or a copied
  // address is the viewer's own style again
  const sharedStyleParam = searchParams.get('style')
  const showSharedStyle = useSetAtom(showSharedLyricsStyleAtom)
  useEffect(() => {
    if (stageVideoId === null || sharedStyleParam === null) {
      return
    }
    const shared = decodeSharedStyle(sharedStyleParam)
    if (shared !== null) {
      showSharedStyle(shared)
    }
    setSearchParams(
      (params) => {
        params.delete('style')
        return params
      },
      { replace: true }
    )
  }, [stageVideoId, sharedStyleParam, showSharedStyle, setSearchParams])

  useEffect(() => {
    let mounted = true
    void handleVideoRoute({
      navigate,
      setError: (err) => {
        if (mounted) {
          setError(err)
        }
      },
      setIsLoading: (loading) => {
        if (mounted) {
          setIsLoading(loading)
        }
      },
      setStateVideoId: (id) => {
        if (mounted) {
          setStageVideoId(id)
        }
      },
      videoId,
    })
    return () => {
      mounted = false
    }
  }, [videoId, navigate])

  if (error !== null && error !== '') {
    return (
      <div className='flex h-dvh w-full flex-col items-center justify-center gap-4 px-4 text-center'>
        <p className='text-red-500'>{error}</p>
        <p className='text-sm text-gray-600'>Video ID: {videoId}</p>
        <button
          type='button'
          onClick={() => {
            void navigate('/')
          }}
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
      <SharedStyleBanner />
      <PlayerStage
        key={stageVideoId}
        videoId={stageVideoId}
        quirks={DEFAULT_YOUTUBE_QUIRKS}
        autoplay={lyricsReady}
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
