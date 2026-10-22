import { pageTurned } from '@/lib/page-turn'
import type { YTPlayer, YTStateCode } from '@/lib/youtube/iframe-api'
import { loadYouTubeIframeApi, YTState } from '@/lib/youtube/iframe-api'

// One YouTube player for the whole visit. iOS lets a media element make sound only after a tap has
// reached that element, and YouTube keeps one <video> per player across cueVideoById: so the player
// outlives every song and page, and one unmute lasts the visit. An iframe reloads whenever it moves in
// the document, so it never moves: it sits in one layer at the top of the body, under the app, laid over
// whichever stage is showing. The layer is placed in the document's coordinates, so where the document
// itself scrolls (the wide watch page) it scrolls with the page natively, never a frame behind it

export interface EngineListener {
  onReady: (player: YTPlayer) => void
  onStateChange: (state: YTStateCode) => void
  onError: (code: number) => void
  onAutoplayBlocked: () => void
}

interface Song {
  videoId: string
  start: number
}

const PLAYER_VARS = {
  cc_load_policy: 0,
  controls: 0,
  disablekb: 1,
  enablejsapi: 1,
  fs: 0,
  hl: 'en',
  iv_load_policy: 3,
  playsinline: 1,
  rel: 0,
}

let layer: HTMLDivElement | null = null
let frame: HTMLDivElement | null = null
let host: HTMLDivElement | null = null
let player: YTPlayer | null = null
let listener: EngineListener | null = null
let song: Song | null = null
let building = false
// Bumped on every rebuild, so a replaced player's late callbacks are dropped
let generation = 0

const ensureLayer = () => {
  if (layer && frame && host) {
    return { frame, host, layer }
  }
  layer = document.createElement('div')
  layer.dataset.stageVideo = ''
  layer.inert = true
  Object.assign(layer.style, {
    background: '#000',
    overflow: 'hidden',
    pointerEvents: 'none',
    position: 'absolute',
    visibility: 'hidden',
  })
  frame = document.createElement('div')
  Object.assign(frame.style, { overflow: 'hidden', position: 'absolute' })
  host = document.createElement('div')
  Object.assign(host.style, { left: '0', position: 'absolute', right: '0' })
  frame.append(host)
  layer.append(frame)
  // First in the body, so everything the app positions paints above it
  document.body.prepend(layer)
  return { frame, host, layer }
}

const create = async () => {
  generation += 1
  const mine = generation
  building = true
  const YT = await loadYouTubeIframeApi().catch(() => null)
  if (mine !== generation) {
    return
  }
  if (YT === null || song === null) {
    building = false
    return
  }
  const target = document.createElement('div')
  ensureLayer().host.replaceChildren(target)
  const { videoId, start } = song
  const created = new YT.Player(target, {
    events: {
      onAutoplayBlocked: () => {
        if (mine === generation) {
          listener?.onAutoplayBlocked()
        }
      },
      onError: ({ data }) => {
        if (mine === generation) {
          listener?.onError(data)
        }
      },
      onReady: () => {
        if (mine !== generation) {
          return
        }
        building = false
        player = created
        listener?.onReady(created)
        // The song asked for may have changed while the player was being built
        if (song !== null && song.videoId !== videoId) {
          created.cueVideoById({
            startSeconds: song.start,
            videoId: song.videoId,
          })
        } else {
          listener?.onStateChange(YTState.Cued)
        }
      },
      onStateChange: ({ data }) => {
        if (mine === generation) {
          listener?.onStateChange(data)
        }
      },
    },
    height: '100%',
    host: 'https://www.youtube-nocookie.com',
    playerVars: {
      ...PLAYER_VARS,
      origin: window.location.origin,
      start: Math.floor(start),
    },
    videoId,
    width: '100%',
  })
}

// The stage listening to the player; a newer one replaces it. Leaving pauses the song
export const connectEngine = (next: EngineListener) => {
  listener = next
  if (player) {
    next.onReady(player)
  }
  return () => {
    if (listener === next) {
      listener = null
      player?.pauseVideo()
    }
  }
}

// Cue a song, ready to play from `start`; the first one builds the player, and one asked for while it
// is being built is cued once it is ready
export const loadSong = (videoId: string, start = 0) => {
  song = { start, videoId }
  if (player) {
    player.cueVideoById({ startSeconds: start, videoId })
  } else if (!building) {
    void create()
  }
}

// A last resort for an embed that stopped answering: a new player, so the next unmute is a new one too
export const rebuildEngine = (start: number) => {
  if (song === null) {
    return
  }
  song = { ...song, start }
  player?.destroy()
  player = null
  void create()
}

// An element's box in the page's own axes, which the layer is placed in: the browser measures in the
// screen's, and a page turned by Lock Landscape runs down the screen
const pageRect = (element: HTMLElement) => {
  const box = element.getBoundingClientRect()
  return pageTurned()
    ? {
        height: box.width,
        left: box.top,
        top: window.innerWidth - box.right,
        width: box.height,
      }
    : box
}

// Lays the video over a stage and its video box, following both as they resize, until the cleanup
export const placeEngine = (
  stage: HTMLElement,
  box: HTMLElement,
  { cropPx, blockInput }: { cropPx: number; blockInput: boolean }
) => {
  const parts = ensureLayer()
  const place = () => {
    const outer = pageRect(stage)
    const inner = pageRect(box)
    // 0 everywhere but a page that scrolls the document itself
    const scroller = document.scrollingElement
    Object.assign(parts.layer.style, {
      height: `${outer.height}px`,
      left: `${outer.left + (scroller?.scrollLeft ?? 0)}px`,
      top: `${outer.top + (scroller?.scrollTop ?? 0)}px`,
      visibility: 'visible',
      width: `${outer.width}px`,
    })
    Object.assign(parts.frame.style, {
      height: `${inner.height}px`,
      left: `${inner.left - outer.left}px`,
      top: `${inner.top - outer.top}px`,
      width: `${inner.width}px`,
    })
  }
  // Extra iframe height above and below the frame keeps YouTube's title bar out of sight
  Object.assign(parts.host.style, {
    bottom: `${-cropPx}px`,
    pointerEvents: blockInput ? 'none' : 'auto',
    top: `${-cropPx}px`,
  })
  // Taking input, the video rises over the stage's own surface, still under its cover (z-10), lyrics and
  // controls, as when it sat inside the stage
  parts.layer.style.zIndex = blockInput ? '' : '5'
  // Out of the tab order and the accessibility tree unless YouTube's own screen is the thing to use
  parts.layer.inert = blockInput
  place()
  const observer = new ResizeObserver(place)
  observer.observe(stage)
  observer.observe(box)
  window.addEventListener('resize', place)
  return () => {
    observer.disconnect()
    window.removeEventListener('resize', place)
    parts.layer.style.visibility = 'hidden'
    parts.layer.style.zIndex = ''
    parts.layer.inert = true
    parts.host.style.pointerEvents = 'none'
  }
}
