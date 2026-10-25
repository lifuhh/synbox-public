// Whether YouTube lets a video play in an embedded player such as ours. Age-restricted and "viewer
// discretion" videos fail with error 101 or 150 as soon as the player loads, even though the Data API calls
// them embeddable, so only a player can tell.

import { loadYouTubeIframeApi } from './iframe-api'

const YOUTUBE_ONLY_ERRORS = new Set([101, 150])
// The error arrives with or just before onReady; a player still quiet this long after it is playable
const SETTLE_MS = 1500
const TIMEOUT_MS = 10_000

// False only when the player said so. A check that cannot finish (no network, blocked script, timeout)
// answers true: generating is what happened before this check existed.
const ask = async (videoId: string, signal: AbortSignal): Promise<boolean> => {
  const cleanup: (() => void)[] = []
  try {
    const YT = await loadYouTubeIframeApi()
    const box = document.createElement('div')
    box.setAttribute('aria-hidden', 'true')
    // Off screen rather than display:none, which stops the iframe from loading
    box.style.cssText =
      'position:fixed;left:-10000px;top:0;width:200px;height:200px;opacity:0;pointer-events:none'
    const target = document.createElement('div')
    box.append(target)
    document.body.append(box)
    cleanup.push(() => {
      box.remove()
    })
    // oxlint-disable-next-line promise/avoid-new -- turns the player's callbacks into one answer
    return await new Promise<boolean>((resolve) => {
      const after = (ms: number) => {
        const timer = setTimeout(() => {
          resolve(true)
        }, ms)
        cleanup.push(() => {
          clearTimeout(timer)
        })
      }
      signal.addEventListener('abort', () => {
        resolve(true)
      })
      after(TIMEOUT_MS)
      const player = new YT.Player(target, {
        events: {
          onError: ({ data }) => {
            resolve(!YOUTUBE_ONLY_ERRORS.has(data))
          },
          onReady: () => {
            after(SETTLE_MS)
          },
        },
        height: '200',
        // The same host and origin as the player stage, so the answer is the one it would get
        host: 'https://www.youtube-nocookie.com',
        playerVars: { controls: 0, origin: window.location.origin },
        videoId,
        width: '200',
      })
      cleanup.unshift(() => {
        player.destroy()
      })
    })
  } catch {
    return true
  } finally {
    for (const step of cleanup) {
      step()
    }
  }
}

// A video that played is asked once: the Generate Lyrics button asks before the generation starts, and the
// generation's own check then takes that answer instead of loading a second player
const playable = new Set<string>()

export const playsOutsideYouTube = async (
  videoId: string,
  signal: AbortSignal
): Promise<boolean> => {
  if (playable.has(videoId)) {
    return true
  }
  const plays = await ask(videoId, signal)
  if (plays) {
    playable.add(videoId)
  }
  return plays
}
