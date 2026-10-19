// The subset of the YouTube IFrame Player API the player stage uses.
// Reference: https://developers.google.com/youtube/iframe_api_reference

export const YTState = {
  Unstarted: -1,
  Ended: 0,
  Playing: 1,
  Paused: 2,
  Buffering: 3,
  Cued: 5,
} as const
export type YTStateCode = (typeof YTState)[keyof typeof YTState]

export interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  cueVideoById(videoId: string): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): YTStateCode
  setVolume(volume: number): void
  getVolume(): number
  mute(): void
  unMute(): void
  isMuted(): boolean
  getIframe(): HTMLIFrameElement
  destroy(): void
  // Not in the documented API; used by most custom-controls players to drop captions
  loadModule?(name: string): void
  unloadModule?(name: string): void
}

export interface YTPlayerOptions {
  videoId: string
  host?: string
  width?: string
  height?: string
  playerVars?: Record<string, string | number>
  events?: {
    onReady?: () => void
    onStateChange?: (event: { data: YTStateCode }) => void
    onError?: (event: { data: number }) => void
  }
}

interface YTNamespace {
  Player: new (element: HTMLElement, options: YTPlayerOptions) => YTPlayer
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<YTNamespace> | null = null

export const loadYouTubeIframeApi = async (): Promise<YTNamespace> => {
  apiPromise ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT)
      return
    }
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (window.YT) {
        resolve(window.YT)
      }
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.addEventListener('error', () => {
      apiPromise = null
      reject(new Error('Failed to load the YouTube IFrame API'))
    })
    document.head.append(script)
  })
  return apiPromise
}
