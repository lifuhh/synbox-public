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
import {
  PlayerStage,
  StagePlaceholder,
} from '@/components/player-stage/player-stage'
import type { StageLayout } from '@/components/player-stage/player-stage'
import { StageLyrics } from '@/components/player-stage/stage-lyrics'
import type { StagePlayer } from '@/components/player-stage/use-you-tube-player'
import { DEFAULT_YOUTUBE_QUIRKS } from '@/components/player-stage/youtube-quirks'
import { NotInLibrary } from '@/components/watch/not-in-library'
import { WatchPage } from '@/components/watch/watch-page'
import {
  chartSongAtom,
  currentVideoAtom,
  lyricsStyleSongAtom,
  playerSurfaceAtom,
  showSharedLyricsStyleAtom,
  stageFullscreenAtom,
  theaterShownAtom,
  watchLayoutAtom,
} from '@/context/atoms'
import {
  PHONE_QUERY,
  useLandscapeHeld,
  useLandscapeHold,
} from '@/hooks/use-landscape-lock'
import { useLyricsReady } from '@/hooks/use-lyrics-ready'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useSongVisit } from '@/hooks/use-song-visit'
import type { SongVisit } from '@/hooks/use-song-visit'
import { useAccess } from '@/lib/auth'
import { useSongPresence } from '@/lib/library/presence'
import type { SongPresence } from '@/lib/library/presence'
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

// The stage alone fills the screen in fullscreen (or iPhone's stand-in), on a phone on its side, and while Lock
// Landscape or a phone's Full Screen holds it on its side; otherwise the page is the watch page around it. A
// phone is in fullscreen only through that hold, so the watch page is back the moment the hold ends, not when
// the browser has finished leaving fullscreen. A video that doesn't play has no stage: its page is an ordinary
// one. `loaded`: the stage is on the page (nothing turns while the player loads). `checking`: whether it plays isn't
// known yet, so the page is laid out as if it does (the stage's placeholder where the stage will be), and nothing
// turns until it is known
const usePlayerSurface = (
  playable: boolean,
  loaded: boolean,
  checking: boolean
) => {
  useLandscapeHold(playable && loaded)
  const fullscreen = useAtomValue(stageFullscreenAtom)
  const phone = useMediaQuery(PHONE_QUERY)
  const short = useMediaQuery(
    '(orientation: landscape) and (max-height: 500px)'
  )
  const held = useLandscapeHeld()
  const surface =
    (playable || checking) && ((fullscreen && !phone) || short || held)
      ? 'stage'
      : 'watch'
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

// The lyrics drawn over the stage, where they go there: on a narrow watch page the lyrics panel under the video
// carries them, and the small video stays clear
const stageLyrics = (over: boolean, videoId: string, version: number | null) =>
  over
    ? (player: StagePlayer, layout: StageLayout) => (
        <StageLyrics
          videoId={videoId}
          player={player}
          layout={layout}
          version={version}
        />
      )
    : undefined

// Theater, on the wide watch page only: the layout and its toggle (undefined where there is none)
const useTheater = (surface: 'stage' | 'watch', wide: boolean) => {
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
  return { layout, toggleTheater }
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

// A library song plays and is counted and kept in history. A chart song (Top 100 Japan, not in the library)
// plays with Generate Lyrics and is kept nowhere until it is generated. Any other video gets NotInLibrary
const VISIT: Record<SongPresence['kind'], SongVisit> = {
  'chart-song': 'show',
  checking: 'none',
  'in-library': 'record',
  'not-in-library': 'none',
}
const samePresence = (a: SongPresence, b: SongPresence) =>
  a.kind === b.kind &&
  (a.kind !== 'chart-song' || (b.kind === 'chart-song' && a.rank === b.rank))
const useSongPresenceEffects = (videoId: string, resumed: boolean) => {
  // A page that has its answer keeps it while the answer is asked again (a chart song's "no lyrics yet", asked again
  // as a new part of the page mounts): only a page with no answer yet waits, so a playing song never stops for it.
  // Kept per song, from the render that first has it
  const asked = useSongPresence(videoId)
  const [settled, setSettled] = useState<{
    videoId: string
    presence: SongPresence
  } | null>(null)
  if (
    asked.kind !== 'checking' &&
    (settled?.videoId !== videoId || !samePresence(settled.presence, asked))
  ) {
    setSettled({ presence: asked, videoId })
  }
  const presence =
    asked.kind === 'checking' && settled?.videoId === videoId
      ? settled.presence
      : asked
  const inLibrary = presence.kind === 'in-library'
  const chartRank = presence.kind === 'chart-song' ? presence.rank : null
  useSongVisit(videoId, VISIT[presence.kind])
  const setChartSong = useSetAtom(chartSongAtom)
  useLayoutEffect(() => {
    setChartSong(chartRank === null ? null : { rank: chartRank, videoId })
  }, [chartRank, videoId, setChartSong])
  useEffect(
    () => () => {
      setChartSong(null)
    },
    [setChartSong]
  )
  // Every visit to a library song's page is one more listen, but the song coming back from the mini bar was
  // counted when it started. A layout effect, so the listen is on its way before any part of the page asks for
  // the song's stats (those wait for it)
  useLayoutEffect(() => {
    if (videoId !== '' && inLibrary && !resumed) {
      countListen(videoId)
    }
  }, [videoId, inLibrary, resumed])
  return presence
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

  const by = openedBy(useLocation().state)
  const presence = useSongPresenceEffects(videoId, by === 'resume')
  const inLibrary = presence.kind === 'in-library'
  const playable = inLibrary || presence.kind === 'chart-song'
  const currentVideo = useAtomValue(currentVideoAtom)
  // The installed app's mini bar takes the listener back to this song from the other tabs. The song it held
  // until now is the one just left: it goes on Previous's trail, unless Previous is what left it
  const [resumeSong, setResumeSong] = useAtom(resumeSongAtom)
  const setPlayed = useSetAtom(playedAtom)
  // Back from the mini bar, the page fades in around the video flying up into it (globals.css)
  const resumed = by === 'resume'
  useLayoutEffect(() => {
    const root = document.documentElement
    root.toggleAttribute('data-player-enter', resumed)
    return () => {
      delete root.dataset.playerEnter
    }
  }, [resumed])
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

  // Until the video is known to play, the page shows its layout with the stage's placeholder, not a blank screen:
  // the stage (and with it YouTube's player) mounts only for a video that plays
  const stageId =
    isLoading || presence.kind === 'checking' ? null : stageVideoId
  const surface = usePlayerSurface(
    playable,
    stageVideoId !== null,
    presence.kind === 'checking'
  )
  const wide = useMediaQuery('(min-width: 1000px)')
  const { layout, toggleTheater } = useTheater(surface, wide)
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

  if (presence.kind === 'not-in-library') {
    return <NotInLibrary videoId={videoId} />
  }

  // One tree loading or not, so the page around the stage stays mounted as the stage takes the placeholder's place
  return (
    <>
      <title>{`${currentVideo?.title ?? 'Player'} · Synbox`}</title>
      {surface === 'stage' && stageId !== null && <PlayerRail />}
      {previewVersion !== null && stageId !== null && (
        <VersionPreviewBanner videoId={stageId} />
      )}
      {stageId !== null && <SharedStyleBanner />}
      <WatchPage
        surface={surface}
        theater={layout === 'theater'}
        videoId={stageId ?? videoId}
        version={previewVersion}
        loading={stageId === null}
        stage={
          stageId === null ? (
            <StagePlaceholder videoId={videoId} />
          ) : (
            <PlayerStage
              key={stageId}
              videoId={stageId}
              quirks={DEFAULT_YOUTUBE_QUIRKS}
              autoplay={lyricsReady}
              theater={layout === 'theater'}
              onToggleTheater={toggleTheater}
              onEnded={steps.handleEnded}
              onPrevious={steps.handlePrevious}
              onNext={steps.handleNext}
              renderLyrics={stageLyrics(
                surface === 'stage' || wide,
                stageId,
                previewVersion
              )}
            />
          )
        }
      />
    </>
  )
}

export default PlayerPage
