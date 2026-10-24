import { pageFlipped, pageTurned } from '@/lib/page-turn'
import { reducedMotion } from '@/lib/reduced-motion'
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
// The video's size on the stage it was last laid over, kept while it floats; before any stage, YouTube's usual size
let frameSize = { height: 270, width: 480 }

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
    // Scaled from its top left: floating onto the mini bar, and flying between placements
    transformOrigin: '0 0',
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

// The stage or the installed app's mini bar listening to the player; a newer one replaces it. Leaving pauses the
// song, unless another listener takes it in the same commit (the player page handing it to the mini bar) or the
// one leaving keeps it going (the mini bar handing it back to a page that connects once it has loaded)
export const connectEngine = (next: EngineListener) => {
  listener = next
  if (player) {
    next.onReady(player)
  }
  return ({ keepPlaying = false }: { keepPlaying?: boolean } = {}) => {
    if (listener === next) {
      listener = null
      queueMicrotask(() => {
        if (listener === null && !keepPlaying) {
          player?.pauseVideo()
        }
      })
    }
  }
}

// The song the player holds, and whether it is under way (playing, buffering or paused part-way)
export const heldSong = (): { videoId: string; state: YTStateCode } | null => {
  if (player === null || song === null) {
    return null
  }
  const state = player.getPlayerState()
  const underway =
    state === YTState.Playing ||
    state === YTState.Buffering ||
    state === YTState.Paused
  return underway ? { state, videoId: song.videoId } : null
}

// Cue a song, ready to play from `start`; the first one builds the player, and one asked for while it
// is being built is cued once it is ready. The song the player already holds under way is kept where it is
// (back from the mini bar), and its state returned; otherwise null
export const loadSong = (videoId: string, start = 0): YTStateCode | null => {
  const held = heldSong()
  if (held !== null && held.videoId === videoId) {
    return held.state
  }
  song = { start, videoId }
  if (player) {
    player.cueVideoById({ startSeconds: start, videoId })
  } else if (!building) {
    void create()
  }
  return null
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
  if (!pageTurned()) {
    return box
  }
  return pageFlipped()
    ? {
        height: box.width,
        left: window.innerHeight - box.bottom,
        top: box.left,
        width: box.height,
      }
    : {
        height: box.width,
        left: box.top,
        top: window.innerWidth - box.right,
        width: box.height,
      }
}

// The placement in force, for a box that moves without resizing (a transform: the mini bar's zoom)
let placed: (() => void) | null = null
export const followEngine = () => {
  placed?.()
}

// Where the video showed when its last placement ended, so the next one flies it from there: the player's stage
// down into the mini bar, and back. A placement left hidden counts only briefly (the next one is the same hand-over);
// one left shown (the bar handing back to a page still loading) counts until the next
interface Flight {
  rect: DOMRect
  radius: number
  until: number
}
let flight: Flight | null = null
// The layer's stacking before the drag to minimise raised it (dragEngine); a placement ending ends the drag
let zBeforeDrag: string | null = null
const HAND_OVER_MS = 600
const FLY_MS = 320

// Animates the video from the last placement's box to where it now is, by a transform from the layer's own top
// left: `final` is the transform the placement settled on
const fly = (video: HTMLDivElement, final: string, finalRadius: string) => {
  const from = flight
  flight = null
  if (from === null || performance.now() > from.until || reducedMotion()) {
    return
  }
  const to = video.getBoundingClientRect()
  const width = video.offsetWidth
  const height = video.offsetHeight
  if (to.width === 0 || width === 0 || height === 0) {
    return
  }
  const sx = from.rect.width / width
  const sy = from.rect.height / height
  video.animate(
    [
      {
        borderRadius: `${from.radius / sx}px / ${from.radius / sy}px`,
        transform: `translate(${from.rect.left - to.left}px, ${from.rect.top - to.top}px) scale(${sx}, ${sy})`,
      },
      { borderRadius: finalRadius || '0px', transform: final || 'none' },
    ],
    { duration: FLY_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
  )
}

// Places the video now and again whenever a watched element resizes, until the cleanup. `keepShown`: the video stays
// where it is until the next placement (the mini bar handing it back to a page still loading)
const keepPlaced = (
  place: () => void,
  watched: HTMLElement[],
  radiusPx = 0
) => {
  const parts = ensureLayer()
  place()
  fly(parts.layer, parts.layer.style.transform, parts.layer.style.borderRadius)
  placed = place
  const observer = new ResizeObserver(place)
  for (const element of watched) {
    observer.observe(element)
  }
  window.addEventListener('resize', place)
  return ({ keepShown = false }: { keepShown?: boolean } = {}) => {
    if (placed === place) {
      placed = null
    }
    observer.disconnect()
    window.removeEventListener('resize', place)
    zBeforeDrag = null
    if (parts.layer.style.visibility === 'visible') {
      flight = {
        radius: radiusPx,
        rect: parts.layer.getBoundingClientRect(),
        until: keepShown
          ? Number.POSITIVE_INFINITY
          : performance.now() + HAND_OVER_MS,
      }
    }
    if (keepShown) {
      return
    }
    Object.assign(parts.layer.style, {
      borderRadius: '',
      transform: '',
      visibility: 'hidden',
      willChange: '',
      zIndex: '',
    })
    parts.layer.inert = true
    parts.host.style.pointerEvents = 'none'
  }
}

// 0 everywhere but a page that scrolls the document itself
const scrolled = () => ({
  left: document.scrollingElement?.scrollLeft ?? 0,
  top: document.scrollingElement?.scrollTop ?? 0,
})

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
    const scroll = scrolled()
    Object.assign(parts.layer.style, {
      borderRadius: '',
      height: `${outer.height}px`,
      left: `${outer.left + scroll.left}px`,
      top: `${outer.top + scroll.top}px`,
      transform: '',
      visibility: 'visible',
      width: `${outer.width}px`,
    })
    Object.assign(parts.frame.style, {
      height: `${inner.height}px`,
      left: `${inner.left - outer.left}px`,
      top: `${inner.top - outer.top}px`,
      width: `${inner.width}px`,
    })
    frameSize = { height: inner.height, width: inner.width }
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
  return keepPlaced(place, [stage, box])
}

export interface ScreenBox {
  left: number
  top: number
  width: number
  height: number
}

// The video's box on screen where its placement put it, or null while it isn't shown
export const engineBox = (): DOMRect | null => {
  const { layer: video } = ensureLayer()
  return video.style.visibility === 'visible'
    ? video.getBoundingClientRect()
    : null
}

// The video drawn into `to` by a finger dragging the player down (the drag to minimise), from `from`, its box as
// placed: a transform, never a resize, raised over the app so the mini bar's stand-in shows under it. `null` puts it
// back as placed
export const dragEngine = (
  move: { from: ScreenBox; to: ScreenBox; radiusPx: number } | null
) => {
  const { layer: video } = ensureLayer()
  if (move === null) {
    Object.assign(video.style, {
      borderRadius: '',
      transform: '',
      willChange: '',
      zIndex: zBeforeDrag ?? video.style.zIndex,
    })
    zBeforeDrag = null
    return
  }
  const { from, to, radiusPx } = move
  zBeforeDrag ??= video.style.zIndex
  const sx = to.width / from.width
  const sy = to.height / from.height
  Object.assign(video.style, {
    borderRadius: `${radiusPx / sx}px / ${radiusPx / sy}px`,
    transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${sx}, ${sy})`,
    willChange: 'transform',
    // Over the tab bar (z-40), as the mini bar's video is
    zIndex: '41',
  })
}
// Shrinks the video onto a small box over the app (the mini bar's thumbnail), rounded. Scaled, never resized: YouTube
// pauses an embed grown back from a tiny size, and a transform costs no layout, so the video keeps the size its stage
// gave it
export const floatEngine = (target: HTMLElement, radiusPx: number) => {
  const parts = ensureLayer()
  const { width, height } = frameSize
  Object.assign(parts.frame.style, {
    height: `${height}px`,
    left: '0',
    top: '0',
    width: `${width}px`,
  })
  const place = () => {
    const box = pageRect(target)
    const scroll = scrolled()
    const sx = box.width / width
    const sy = box.height / height
    Object.assign(parts.layer.style, {
      borderRadius: `${radiusPx / sx}px / ${radiusPx / sy}px`,
      height: `${height}px`,
      left: `${box.left + scroll.left}px`,
      top: `${box.top + scroll.top}px`,
      transform: `scale(${sx}, ${sy})`,
      visibility: 'visible',
      width: `${width}px`,
    })
  }
  parts.host.style.pointerEvents = 'none'
  parts.layer.inert = true
  // Over the tab bar (z-40)
  parts.layer.style.zIndex = '41'
  return keepPlaced(place, [target], radiusPx)
}
