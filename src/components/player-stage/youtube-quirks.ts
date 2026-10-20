// Every value here is tuned against YouTube's embed UI as observed, not
// documented behaviour. When YouTube changes its player, this is the file to
// re-tune; the stage lab (/lab/stage in dev) toggles each one live.
export interface YouTubeQuirks {
  // A transparent layer takes all pointer input, so YouTube never sees a hover
  // and never shows its hover title bar
  blockIframeInput: boolean
  // Extra iframe height above and below the visible frame. YouTube letterboxes
  // the video inside the taller iframe, so its title bar and logo land in the
  // clipped bands while the picture stays whole. Its top shade is up to 146px
  // tall (big mode) and fades on YouTube's own timer after a play or seek
  cropPx: number
  // Where a pause shows our cover (touch screens), show it before asking
  // YouTube to pause, so the pause never lands a frame early
  coverBeforePause: boolean
  // Keep the cover this long after YouTube reports PLAYING, hiding the
  // title flash on resume
  coverHoldMs: number
  // Captions can turn on from the viewer's YouTube settings regardless of
  // cc_load_policy, and come back after seeks; unload them on every PLAYING
  unloadCaptions: boolean
  // Stop this many seconds before the end so YouTube never reaches ENDED and
  // never shows its suggested-videos end screen. getDuration() is sometimes
  // rounded up to the next whole second, so this must be at least 1. 0 disables
  endGuardSec: number
}

export const DEFAULT_YOUTUBE_QUIRKS: YouTubeQuirks = {
  blockIframeInput: true,
  cropPx: 150,
  coverBeforePause: true,
  coverHoldMs: 150,
  unloadCaptions: true,
  endGuardSec: 1,
}
