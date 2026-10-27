// The player's single-key shortcuts, YouTube's where the player has the action. One table for the key handler
// (player-stage.tsx) and the labels the control bar shows over its buttons, so a label never names a key that does
// something else. The arrow keys (seek 5 s, ramping while held; volume) and Escape are handled beside these: no button
// shows them

const ACTIONS = [
  'playPause',
  'back',
  'forward',
  'mute',
  'fullscreen',
  'theater',
  'zoom',
  'previous',
  'next',
  'slower',
  'faster',
  'lyrics',
] as const
export type PlayerAction = (typeof ACTIONS)[number]

interface Shortcut {
  /** `event.key` values, lower case for letters */
  keys: readonly string[]
  /** What the label shows, one key cap each */
  caps: readonly string[]
  /** Shift is part of the shortcut (Shift+N); a symbol key (< >) takes it either way, as layouts differ */
  shift: 'with' | 'without' | 'either'
}

export const SHORTCUTS: Record<PlayerAction, Shortcut> = {
  back: { caps: ['J'], keys: ['j'], shift: 'without' },
  faster: { caps: ['>'], keys: ['>'], shift: 'either' },
  forward: { caps: ['L'], keys: ['l'], shift: 'without' },
  fullscreen: { caps: ['F'], keys: ['f'], shift: 'without' },
  lyrics: { caps: ['C'], keys: ['c'], shift: 'without' },
  mute: { caps: ['M'], keys: ['m'], shift: 'without' },
  next: { caps: ['Shift', 'N'], keys: ['n'], shift: 'with' },
  playPause: { caps: ['K'], keys: ['k', ' '], shift: 'without' },
  previous: { caps: ['Shift', 'P'], keys: ['p'], shift: 'with' },
  slower: { caps: ['<'], keys: ['<'], shift: 'either' },
  theater: { caps: ['T'], keys: ['t'], shift: 'without' },
  zoom: { caps: ['Z'], keys: ['z'], shift: 'without' },
}

// Ctrl, Cmd and Alt belong to the browser and the system
export const shortcutFor = (event: KeyboardEvent): PlayerAction | null => {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return null
  }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  return (
    ACTIONS.find((action) => {
      const { keys, shift } = SHORTCUTS[action]
      return (
        keys.includes(key) &&
        (shift === 'either' || (shift === 'with') === event.shiftKey)
      )
    }) ?? null
  )
}

// For a button's aria-keyshortcuts: "Shift+N", "K"
export const ariaKeys = (action: PlayerAction) =>
  SHORTCUTS[action].caps.join('+')
