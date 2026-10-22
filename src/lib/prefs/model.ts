// Settings that follow a signed-in listener to every device. On a device each lives in local storage under the
// key it always had; the account keeps the same keys (worker/src/prefs.ts), each last-write-wins on when it
// changed. Settings that belong to one device (volume, the watch layout, the video's fit, the queue) never
// sync.

const SYNCED_KEYS = new Set([
  // My Default lyrics style, one key per field
  'fontSizeMultiplier',
  'lyricsFontSizeTwoLines',
  'lyricsAnchor',
  'lyricsAnchorPortrait',
  'lyricsTranslationAnchor',
  'lyricsCustomHue',
  'lyricsScreenSizes',
  'lyricsTheme',
  'lyricsTwoLines',
  // My Styles
  'lyricsTemplates',
  // What the lyrics show
  'lyricsShowLyrics',
  'lyricsShowRomaji',
  'lyricsShowTranslation',
  'lyricsTranslationEnglish',
  // The reader, and whether a song's end plays the next one
  'offlineReader',
  'listeningAutoplay',
])
// A song's own lyrics style
const SONG_STYLE = /^lyricsStyle:[\w-]{6,64}$/u

export const isSyncedKey = (key: string) =>
  SYNCED_KEYS.has(key) || SONG_STYLE.test(key)

// A setting as the account or this device has it: null when it is back at its default
export interface PrefValue {
  value: unknown
  at: number
}
export type Prefs = Record<string, PrefValue>

export interface PrefOp {
  key: string
  value: unknown
  at: number
}

// This device's settings: each one's value (undefined when unset) and when it was last changed here
// (undefined: not since this device started keeping times, e.g. set before syncing existed)
export interface LocalPref {
  value: unknown
  at: number | undefined
}

export interface Reconciled {
  // Newer on the account: to write on this device, with the account's time
  apply: { key: string; value: unknown; at: number }[]
  // Newer on this device, or only here: to send
  send: PrefOp[]
}

// The newest change wins, setting by setting. A setting this device never timed loses to the account's,
// and is sent only when the account has none (a first sign-in keeps what the device already looked like)
export const reconcile = (
  account: Prefs,
  local: Record<string, LocalPref>,
  now: number
): Reconciled => {
  const apply: Reconciled['apply'] = []
  const send: PrefOp[] = []
  const keys = new Set([...Object.keys(account), ...Object.keys(local)])
  for (const key of [...keys].toSorted()) {
    const theirs = account[key]
    const ours = local[key]
    if (ours?.at !== undefined) {
      if (theirs === undefined || ours.at > theirs.at) {
        send.push({ at: ours.at, key, value: ours.value ?? null })
      } else if (theirs.at > ours.at) {
        apply.push({ at: theirs.at, key, value: theirs.value })
      }
    } else if (theirs !== undefined) {
      apply.push({ at: theirs.at, key, value: theirs.value })
    } else if (ours !== undefined && ours.value !== undefined) {
      send.push({ at: now, key, value: ours.value })
    }
  }
  return { apply, send }
}
