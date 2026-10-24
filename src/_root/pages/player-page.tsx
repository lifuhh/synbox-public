import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useLayoutEffect, useState } from 'react'
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router'

import PlayerRail from '@/components/lyrics-display/player-rail'
import SharedStyleBanner from '@/components/lyrics-display/shared-style-banner'
import VersionPreviewBanner, {
  parsePreviewVersion,
} from '@/components/lyrics-display/version-preview-banner'
import { PlayerStage } from '@/components/player-stage/player-stage'
import { StageLyrics } from '@/components/player-stage/stage-lyrics'
import { DEFAULT_YOUTUBE_QUIRKS } from '@/components/player-stage/youtube-quirks'
import { NotInLibrary } from '@/components/watch/not-in-library'
import { WatchPage } from '@/components/watch/watch-page'
import {
  currentVideoAtom,
  lyricsStyleSongAtom,
  playerSurfaceAtom,
  showSharedLyricsStyleAtom,
  stageFullscreenAtom,
  theaterShownAtom,
  watchLayoutAtom,
} from '@/context/atoms'
import { usePageTurned } from '@/hooks/use-landscape-lock'
import { useLyricsReady } from '@/hooks/use-lyrics-ready'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useSongVisit } from '@/hooks/use-song-visit'
import { useAccess } from '@/lib/auth'
import { useSongPresence } from '@/lib/library/presence'
import { historyAtom } from '@/lib/library/store'
import type { ListSong } from '@/lib/listening/model'
import {
  followSong,
  leftSong,
  nextSong,
  previousSong,
} from '@/lib/listening/model'
import { useNextList } from '@/lib/listening/recommendations'
import {
  autoplayAtom,
  contextAtom,
  openedBy,
  playedAtom,
  queueAtom,
  resumeSongAtom,
  songPath,
  songState,
} from '@/lib/listening/store'
import type { OpenedBy } from '@/lib/listening/store'
import { decodeSharedStyle } from '@/lib/lyrics-style'
import { countListen } from '@/lib/song-stats'
import { handleVideoRoute } from '@/utils/route-handler.ts'

// The stage alone fills the screen in fullscreen (or iPhone's stand-in), on a phone on its side and under
// Lock Landscape; otherwise the page is the watch page around it. A video not in the library has no stage: its
// page is an ordinary one
const usePlayerSurface = (inLibrary: boolean) => {
  const fullscreen = useAtomValue(stageFullscreenAtom)
  const short = useMediaQuery(
    '(orientation: landscape) and (max-height: 500px)'
  )
  const turned = usePageTurned()
  const surface =
    inLibrary && (fullscreen || short || turned) ? 'stage' : 'watch'
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

// The songs either side of this one (model › nextSong, previousSong): what plays when it ends (the queue's next
// song, else the playlist's, else with autoplay on a recommendation not played lately), what Next plays (the
// same, autoplay or not) and what Previous goes back to. Undefined where there is none
const useSongSteps = (videoId: string) => {
  const navigate = useNavigate()
  const [queue, setQueue] = useAtom(queueAtom)
  const [context, setContext] = useAtom(contextAtom)
  const [played, setPlayed] = useAtom(playedAtom)
  const autoplay = useAtomValue(autoplayAtom)
  const history = useAtomValue(historyAtom)
  const current = useAtomValue(currentVideoAtom)
  const { songs } = useNextList(videoId)
  const recent = history.slice(0, 20).map((item) => item.videoId)
  const open = (song: ListSong, by?: OpenedBy) => {
    void navigate(songPath(song.videoId), {
      state: songState(song.videoId, by),
    })
  }
  const forward = (pressed: boolean) => {
    const next = nextSong(
      { autoplay, context, queue },
      videoId,
      songs,
      recent,
      pressed
    )
    return next === null
      ? undefined
      : () => {
          setQueue(next.queue)
          setContext(next.context)
          // A song from the queue leaves the playlist waiting; the playlist's own is in it
          open(next.song, next.context === context ? 'queued' : undefined)
        }
  }
  const back =
    current?.videoId === videoId
      ? previousSong(played, { context, queue }, current)
      : null
  return {
    handleEnded: forward(false),
    handleNext: forward(true),
    handlePrevious:
      back === null
        ? undefined
        : () => {
            setPlayed(back.played)
            setQueue(back.queue)
            setContext(back.context)
            open(back.song, 'back')
          },
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

  // Only a song in the library is played, counted and kept in history; any other video gets NotInLibrary
  const presence = useSongPresence(videoId)
  const inLibrary = presence === 'in-library'
  useSongVisit(videoId, inLibrary)
  // Every visit to a song's player page is one more listen. A layout effect, so the listen is on its way before
  // any part of the page asks for the song's stats (those wait for it)
  useLayoutEffect(() => {
    if (videoId !== '' && inLibrary) {
      countListen(videoId)
    }
  }, [videoId, inLibrary])
  const currentVideo = useAtomValue(currentVideoAtom)
  // The installed app's resume bar takes the listener back to this song from the other tabs. The song it held
  // until now is the one just left: it goes on Previous's trail, unless Previous is what left it
  const [resumeSong, setResumeSong] = useAtom(resumeSongAtom)
  const setPlayed = useSetAtom(playedAtom)
  const by = openedBy(useLocation().state)
  useEffect(() => {
    if (currentVideo !== null && currentVideo.videoId === videoId) {
      if (
        resumeSong !== null &&
        resumeSong.videoId !== videoId &&
        by !== 'back'
      ) {
        setPlayed((played) => leftSong(played, resumeSong))
      }
      setResumeSong(currentVideo)
    }
  }, [currentVideo, videoId, resumeSong, by, setResumeSong, setPlayed])
  // The playlist being played follows the song: one of its songs becomes its place, and a song picked from
  // anywhere else ends it (model › followSong)
  const setContext = useSetAtom(contextAtom)
  useEffect(() => {
    if (videoId !== '') {
      setContext((context) => followSong(context, videoId, by !== undefined))
    }
  }, [videoId, by, setContext])
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

  const surface = usePlayerSurface(inLibrary)
  const wide = useMediaQuery('(min-width: 1000px)')
  const [layout, setLayout] = useAtom(watchLayoutAtom)
  const toggleTheater =
    surface === 'watch' && wide
      ? () => {
          setLayout(layout === 'theater' ? 'default' : 'theater')
        }
      : undefined
  const theaterShown = surface === 'watch' && wide && layout === 'theater'
  const setTheaterShown = useSetAtom(theaterShownAtom)
  // Before paint, so Theater's lyrics open in their layout instead of switching to it a frame later
  useLayoutEffect(() => {
    setTheaterShown(theaterShown)
  }, [theaterShown, setTheaterShown])
  useEffect(
    () => () => {
      setTheaterShown(false)
    },
    [setTheaterShown]
  )
  const steps = useSongSteps(videoId)

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

  if (presence === 'not-in-library') {
    return <NotInLibrary videoId={videoId} />
  }

  if (isLoading || stageVideoId === null || presence === 'checking') {
    return (
      <div className='flex h-(--app-h) w-full items-center justify-center'>
        Loading...
      </div>
    )
  }

  return (
    <>
      <title>{`${currentVideo?.title ?? 'Player'} · Synbox`}</title>
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
            onEnded={steps.handleEnded}
            onPrevious={steps.handlePrevious}
            onNext={steps.handleNext}
            // On a narrow watch page the lyrics panel under the video carries the lyrics; the small video stays
            // clear
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
