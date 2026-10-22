import { useAtom, useAtomValue, useSetAtom } from 'jotai'
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
import { WatchPage } from '@/components/watch/watch-page'
import {
  currentVideoAtom,
  lyricsStyleSongAtom,
  playerSurfaceAtom,
  showSharedLyricsStyleAtom,
  stageFullscreenAtom,
  watchLayoutAtom,
} from '@/context/atoms'
import { usePageTurned } from '@/hooks/use-landscape-lock'
import { useLyricsReady } from '@/hooks/use-lyrics-ready'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useSongVisit } from '@/hooks/use-song-visit'
import { useAccess } from '@/lib/auth'
import { historyAtom } from '@/lib/library/store'
import { nextSong } from '@/lib/listening/model'
import { useNextList } from '@/lib/listening/recommendations'
import {
  autoplayAtom,
  queueAtom,
  queueSourceAtom,
  resumeSongAtom,
  songPath,
} from '@/lib/listening/store'
import { decodeSharedStyle } from '@/lib/lyrics-style'
import { handleVideoRoute } from '@/utils/route-handler.ts'

// The stage alone fills the screen in fullscreen (or iPhone's stand-in), on a phone on its side and under
// Lock Landscape; otherwise the page is the watch page around it
const usePlayerSurface = () => {
  const fullscreen = useAtomValue(stageFullscreenAtom)
  const short = useMediaQuery(
    '(orientation: landscape) and (max-height: 500px)'
  )
  const turned = usePageTurned()
  const surface = fullscreen || short || turned ? 'stage' : 'watch'
  const setSurface = useSetAtom(playerSurfaceAtom)
  useEffect(() => {
    setSurface(surface)
  }, [surface, setSurface])
  useEffect(
    () => () => {
      setSurface(null)
    },
    [setSurface]
  )
  return surface
}

// When a song ends: the queue's next song, else (autoplay on) a recommendation not played lately
const usePlayNext = (videoId: string) => {
  const navigate = useNavigate()
  const [queue, setQueue] = useAtom(queueAtom)
  const [source, setSource] = useAtom(queueSourceAtom)
  const autoplay = useAtomValue(autoplayAtom)
  const history = useAtomValue(historyAtom)
  const { songs } = useNextList(videoId)
  return () => {
    const next = nextSong(
      { autoplay, queue, source },
      videoId,
      songs,
      history.slice(0, 20).map((item) => item.videoId)
    )
    if (next === null) {
      return
    }
    setQueue(next.queue)
    if (
      next.queue.length === 0 &&
      !queue.some((song) => song.videoId === next.song.videoId)
    ) {
      setSource(null)
    }
    void navigate(songPath(next.song.videoId), {
      state: { videoId: next.song.videoId },
    })
  }
}

const PlayerPage = () => {
  const navigate = useNavigate()
  const { videoId = '' } = useParams<{ videoId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  // Lyrics versions are an admin tool: anyone else always gets the song's current lyrics
  const { admin } = useAccess()
  const previewVersion = admin
    ? parsePreviewVersion(searchParams.get('version'))
    : null

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stageVideoId, setStageVideoId] = useState<string | null>(null)

  useSongVisit(videoId)
  const currentVideo = useAtomValue(currentVideoAtom)
  // The installed app's resume bar takes the listener back to this song from the other tabs
  const setResumeSong = useSetAtom(resumeSongAtom)
  useEffect(() => {
    if (currentVideo !== null && currentVideo.videoId === videoId) {
      setResumeSong(currentVideo)
    }
  }, [currentVideo, videoId, setResumeSong])
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

  const surface = usePlayerSurface()
  const wide = useMediaQuery('(min-width: 1000px)')
  const [layout, setLayout] = useAtom(watchLayoutAtom)
  const toggleTheater =
    surface === 'watch' && wide
      ? () => {
          setLayout(layout === 'theater' ? 'default' : 'theater')
        }
      : undefined
  const playNext = usePlayNext(videoId)

  if (error !== null && error !== '') {
    return (
      <div className='flex h-(--app-h) w-full flex-col items-center justify-center gap-4 px-4 text-center'>
        <p className='text-error-strong'>{error}</p>
        <p className='text-sm text-faint'>Video ID: {videoId}</p>
        <button
          type='button'
          onClick={() => {
            void navigate('/')
          }}
          className='rounded-full bg-primary-subtle px-4 py-2 font-semibold text-primary-text transition-colors hover:bg-primary-subtle-hover'>
          Return Home
        </button>
      </div>
    )
  }

  if (isLoading || stageVideoId === null) {
    return (
      <div className='flex h-(--app-h) w-full items-center justify-center'>
        Loading...
      </div>
    )
  }

  return (
    <>
      <title>{`${currentVideo?.title ?? 'Player Page'} | Synbox`}</title>
      {surface === 'stage' && <PlayerRail />}
      {previewVersion !== null && (
        <VersionPreviewBanner videoId={stageVideoId} />
      )}
      <SharedStyleBanner />
      <WatchPage
        surface={surface}
        theater={layout === 'theater'}
        videoId={stageVideoId}
        version={previewVersion}
        stage={
          <PlayerStage
            key={stageVideoId}
            videoId={stageVideoId}
            quirks={DEFAULT_YOUTUBE_QUIRKS}
            autoplay={lyricsReady}
            theater={layout === 'theater'}
            onToggleTheater={toggleTheater}
            onEnded={playNext}
            // On a narrow watch page the Lyrics tab carries the lyrics; the small video stays clear
            renderLyrics={
              surface === 'watch' && !wide
                ? undefined
                : (player, stageLayout) => (
                    <StageLyrics
                      videoId={stageVideoId}
                      player={player}
                      layout={stageLayout}
                      version={previewVersion}
                    />
                  )
            }
          />
        }
      />
    </>
  )
}

export default PlayerPage
