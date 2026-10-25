import { runGrow } from '@/lib/grow'
import { pageFlipped, pageTurned, turnedPageEnd } from '@/lib/page-turn'
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

// YouTube picks an embed's quality from the size it is drawn at, in device pixels; setPlaybackQuality has done nothing
// since 2019. Measured: a 16:9 player gets 1080p from about 1700 device pixels wide, 720p below, so an upright phone or
// a small window got 720p. A smaller player is drawn as wide as a 1080p frame and scaled down. Its adaptive bitrate
// still drops lower on a slow connection (700 kbit/s: 480p at either size), so this only lifts the ceiling
const FULL_HD_WIDTH = 1920
const MAX_SCALE = 2
// Drawn at its own size where data is short: Data Saver, a slow connection (Chromium reports both; Safari and
// Firefox nothing), or STALLS_TO_SAVE stalls this visit, each a wait of STALL_MS or more mid-song
const SLOW_NETWORKS = new Set(['slow-2g', '2g', '3g'])
const STALL_MS = 2000
const STALLS_TO_SAVE = 2
let stalls = 0
let bufferingSince = 0
let lastState: YTStateCode | null = null
const noteState = (state: YTStateCode) => {
  const now = performance.now()
  if (state === YTState.Buffering && lastState === YTState.Playing) {
    bufferingSince = now
  } else if (state !== YTState.Buffering && bufferingSince > 0) {
    if (now - bufferingSince >= STALL_MS) {
      stalls += 1
    }
    bufferingSince = 0
  }
  lastState = state
}
const savingData = () => {
  const connection: unknown = Reflect.get(navigator, 'connection')
  const saveData: unknown =
    connection instanceof EventTarget
      ? Reflect.get(connection, 'saveData')
      : undefined
  const effectiveType: unknown =
    connection instanceof EventTarget
      ? Reflect.get(connection, 'effectiveType')
      : undefined
  return (
    saveData === true ||
    (typeof effectiveType === 'string' && SLOW_NETWORKS.has(effectiveType)) ||
    stalls >= STALLS_TO_SAVE
  )
}
// How much larger than the frame the iframe is drawn: the video's shown width up to a 1080p frame's, ×1 to ×2
const videoScale = (width: number, height: number) => {
  const shown = Math.min(width, (height * 16) / 9) * window.devicePixelRatio
  return shown <= 0 || savingData()
    ? 1
    : Math.min(MAX_SCALE, Math.max(1, FULL_HD_WIDTH / shown))
}
// The iframe over a frame `width` × `height`, `cropPx` taller above and below (YouTube's title bar out of sight), laid
// out `scale` times larger and shrunk back from its top left, so it covers the same box
const sizeHost = (
  iframeBox: HTMLDivElement,
  { width, height }: { width: number; height: number },
  cropPx: number,
  scale: number
) => {
  Object.assign(iframeBox.style, {
    bottom: '',
    height: `${(height + 2 * cropPx) * scale}px`,
    right: '',
    top: `${-cropPx}px`,
    transform: scale === 1 ? '' : `scale(${1 / scale})`,
    transformOrigin: '0 0',
    width: `${width * scale}px`,
  })
}

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
        noteState(data)
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
        left: turnedPageEnd() - box.bottom,
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
// The stage's placement (placeEngine), the one in force while `placed` is it
let staged: (() => void) | null = null
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
// The layer's stacking before the drag to minimise raised it (dragEngine), and the drag's own drawing, which a
// placement redone mid-drag (a resize, and the first report of every ResizeObserver) keeps; a placement ending
// ends the drag
let zBeforeDrag: string | null = null
let dragged: { borderRadius: string; transform: string } | null = null
// Told once, right after the next placement is drawn, in the same update: the drag to minimise growing the video
// back out of the bar takes it before any frame shows the placement's own flight
let placedListener: (() => void) | null = null
export const whenPlaced = (next: (() => void) | null) => {
  placedListener = next
}
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
  const told = placedListener
  placedListener = null
  told?.()
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
    dragged = null
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

// Where the stage last laid the video, on a screen of this size: where the tap on the mini bar grows it back to
// before the player page exists (growEngine)
let lastStage: { box: ScreenBox; width: number; height: number } | null = null
export const predictedStage = (): ScreenBox | null =>
  lastStage !== null &&
  lastStage.width === window.innerWidth &&
  lastStage.height === window.innerHeight
    ? lastStage.box
    : null

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
      borderRadius: dragged?.borderRadius ?? '',
      height: `${outer.height}px`,
      left: `${outer.left + scroll.left}px`,
      top: `${outer.top + scroll.top}px`,
      transform: dragged?.transform ?? '',
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
    lastStage = {
      box: {
        height: outer.height,
        left: outer.left,
        top: outer.top,
        width: outer.width,
      },
      height: window.innerHeight,
      width: window.innerWidth,
    }
    // YouTube's own screens (errors, sign-in) are read and pressed: at their own size
    sizeHost(
      parts.host,
      frameSize,
      cropPx,
      blockInput ? videoScale(inner.width, inner.height) : 1
    )
  }
  parts.host.style.pointerEvents = blockInput ? 'none' : 'auto'
  // Taking input, the video rises over the stage's own surface, still under its cover (z-10), lyrics and
  // controls, as when it sat inside the stage
  parts.layer.style.zIndex = blockInput ? '' : '5'
  // Out of the tab order and the accessibility tree unless YouTube's own screen is the thing to use
  parts.layer.inert = blockInput
  staged = place
  return keepPlaced(place, [stage, box])
}

export interface ScreenBox {
  left: number
  top: number
  width: number
  height: number
}

// The video's box on screen where the stage placed it, or null while it isn't shown there
export const engineBox = (): DOMRect | null => {
  const { layer: video } = ensureLayer()
  return placed !== null &&
    placed === staged &&
    video.style.visibility === 'visible'
    ? video.getBoundingClientRect()
    : null
}

// Ends the flight into the current placement (fly) at once, for the drag to minimise to draw the way back itself
export const stopFlight = () => {
  for (const animation of ensureLayer().layer.getAnimations()) {
    animation.cancel()
  }
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
    dragged = null
    return
  }
  const { from, to, radiusPx } = move
  zBeforeDrag ??= video.style.zIndex
  const sx = to.width / from.width
  const sy = to.height / from.height
  dragged = {
    borderRadius: `${radiusPx / sx}px / ${radiusPx / sy}px`,
    transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${sx}, ${sy})`,
  }
  Object.assign(video.style, {
    ...dragged,
    willChange: 'transform',
    // Over the tab bar (z-40), as the mini bar's video is
    zIndex: '41',
  })
}
// The video grown from `path.to` (the mini bar's thumbnail) to `path.from` (the stage) along the drag to minimise's
// path, as a Web Animation from the layer's own box, joined `startedAt` (performance.now()) into its GROW_MS: the
// compositor runs it while the player page renders. Called on the tap, from wherever the layer is, and again once
// the stage has placed it, the same path from its new box. Null while the video isn't showing
export const growEngine = (
  path: { from: ScreenBox; to: ScreenBox },
  startedAt: number,
  radiusPx: number
): Animation | null => {
  const { layer: video } = ensureLayer()
  if (video.style.visibility !== 'visible' || video.offsetWidth === 0) {
    return null
  }
  stopFlight()
  const scroll = scrolled()
  const base = {
    height: video.offsetHeight,
    left: video.offsetLeft - scroll.left,
    top: video.offsetTop - scroll.top,
    width: video.offsetWidth,
  }
  zBeforeDrag = video.style.zIndex
  dragged = null
  // Over the tab bar (z-40), as the mini bar's video is
  video.style.zIndex = '41'
  const { from, to } = path
  const scaleAt = (t: number) => {
    const box = {
      height: from.height + (to.height - from.height) * t,
      left: from.left + (to.left - from.left) * t,
      top: from.top + (to.top - from.top) * t,
      width: from.width + (to.width - from.width) * t,
    }
    return { box, sx: box.width / base.width, sy: box.height / base.height }
  }
  // The rounding apart from the move: WebKit hands an animation to the compositor only when every property in it is
  // one it can run there (transform, opacity), and the move must keep going while the page renders
  runGrow(
    video,
    (t) => {
      const { sx, sy } = scaleAt(t)
      return {
        borderRadius: `${(radiusPx * t) / sx}px / ${(radiusPx * t) / sy}px`,
      }
    },
    startedAt
  )
  return runGrow(
    video,
    (t) => {
      const { box, sx, sy } = scaleAt(t)
      return {
        transform: `translate(${box.left - base.left}px, ${box.top - base.top}px) scale(${sx}, ${sy})`,
      }
    },
    startedAt
  )
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
