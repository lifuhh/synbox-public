import { flushSync } from 'react-dom'

import { placeEngineNow } from '@/components/player-stage/youtube-engine'
import { reducedMotion } from '@/lib/reduced-motion'

// Theater Mode in and out on the wide watch page, as one view transition: the browser snapshots each moving part of
// the page, the layout changes once (no layout per frame, the YouTube iframe resized in place, never rebuilt), and
// the snapshots move on the compositor, by transform and opacity only:
// - the video, its black surround and the stage's overlay grow (or shrink) from their old box to their new one;
// - the control bar's button groups ride its corners, the seek bar stretches with it;
// - the lyrics panel beside the video shrinks a little and fades where it is, while the one under the video grows
//   in after the video has mostly arrived (the other way round on the way out);
// - the song, More Like This and Up Next slide to their new places.
// Each part is its own snapshot, so nothing cross-fades between two places. Reduce Motion: a plain cross-fade.
// Where view transitions are missing, the layout changes at once, as before

type Kind =
  // From its old box to its new one, scaled: the video and what lies over it
  | 'grow'
  // From its old place to its new one at its own size
  | 'slide'
  // Only in the old layout or only in the new: a panel closing or opening where it stands
  | 'panel'
  // Stays put, above the moving parts (the top bar)
  | 'still'

interface Part {
  name: string
  kind: Kind
  elements: () => Element[]
}

const one = (selector: string) => () => {
  const element = document.querySelector(selector)
  return element === null ? [] : [element]
}

// A box that `display: contents` dissolves can't be snapshotted on its own
const boxed = (element: Element) =>
  getComputedStyle(element).display !== 'contents'

const PARTS: Part[] = [
  { elements: one('[data-topbar]'), kind: 'still', name: 'topbar' },
  { elements: one('[data-stage-video]'), kind: 'grow', name: 'video-surround' },
  {
    // The video's own box, in the video's shape. Zoomed to fill, it overflows the stage, which clips it: the
    // surround carries it then
    elements: () => {
      const stage = document.querySelector<HTMLElement>('[data-player-stage]')
      const frame = document.querySelector('[data-stage-video] > div')
      return stage?.dataset.fit === 'zoom' || frame === null ? [] : [frame]
    },
    kind: 'grow',
    name: 'video',
  },
  // The stage's box on the page, which clips what lies over the video to its rounded corners
  { elements: one('.watch-stage'), kind: 'grow', name: 'stage' },
  {
    elements: one('[data-player-stage] > [data-styling]'),
    kind: 'grow',
    name: 'stage-lyrics',
  },
  {
    elements: one('[data-player-stage] [data-player-chrome]'),
    kind: 'grow',
    name: 'bar',
  },
  {
    // The seek row, stretched with the bar
    elements: one('[data-player-stage] [data-player-chrome] > :first-child'),
    kind: 'grow',
    name: 'seek',
  },
  {
    // Each group of buttons keeps its size and rides the bar's corner it sits by
    elements: () =>
      [
        ...document.querySelectorAll(
          '[data-player-stage] [data-player-chrome] > :last-child > *'
        ),
      ].filter(boxed),
    kind: 'slide',
    name: 'buttons',
  },
  { elements: one('.watch-side'), kind: 'panel', name: 'side-lyrics' },
  {
    elements: one('.watch-main > section'),
    kind: 'panel',
    name: 'under-lyrics',
  },
  {
    elements: one('.watch-main > :first-child'),
    kind: 'slide',
    name: 'song',
  },
  {
    elements: () => {
      const last = document.querySelector('.watch-main > :last-child')
      return last === null || last.matches('section, :first-child')
        ? []
        : [last]
    },
    kind: 'slide',
    name: 'shelves',
  },
  { elements: one('.watch-next'), kind: 'slide', name: 'next' },
]

const MOVE_MS = 400
const VIDEO_FADE_MS = 150
const EASE = 'cubic-bezier(0.2, 0, 0, 1)'
// A panel closing: shorter than the move, as an exit is
const CLOSE_MS = 200
// A panel opening waits for the video to have mostly arrived, then grows in
const OPEN_DELAY_MS = 160
const OPEN_MS = 300
const PANEL_SCALE = 0.96

interface Named {
  element: HTMLElement
  name: string
  kind: Kind
}

// Names each part's elements present now; one already named keeps its name
const nameParts = (named: Map<Element, Named>) => {
  for (const part of PARTS) {
    for (const [index, element] of part.elements().entries()) {
      if (!(element instanceof HTMLElement) || named.has(element)) {
        continue
      }
      const name = `theater-${part.name}${index === 0 ? '' : `-${index}`}`
      element.style.viewTransitionName = name
      // The class picks how its snapshots are drawn (globals.css › html[data-theater-move])
      element.style.setProperty('view-transition-class', `theater ${part.kind}`)
      named.set(element, { element, kind: part.kind, name })
    }
  }
}

const unname = (named: Map<Element, Named>) => {
  for (const { element } of named.values()) {
    element.style.viewTransitionName = ''
    element.style.removeProperty('view-transition-class')
  }
}

const boxes = (named: Map<Element, Named>) =>
  new Map(
    [...named.values()]
      .filter(({ element }) => element.isConnected)
      .map(({ name, element }) => [name, element.getBoundingClientRect()])
  )

const pseudo = (kind: 'group' | 'old' | 'new', name: string) =>
  `::view-transition-${kind}(${name})`

// A group at a box, from the snapshot's top left (its transform origin)
const place = (box: DOMRect) => `translate(${box.left}px, ${box.top}px)`

// The snapshots' motion, once the browser has both: every group sits at its new box (the CSS turns the browser's own
// animations off, html[data-theater-move]), and these move it there from the old one
const animate = (
  parts: Named[],
  before: Map<string, DOMRect>,
  after: Map<string, DOMRect>
) => {
  const root = document.documentElement
  const run = (
    target: string,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions
  ) => {
    root.animate(keyframes, {
      easing: EASE,
      fill: 'both',
      ...options,
      pseudoElement: target,
    })
  }
  for (const { name, kind } of parts) {
    const from = before.get(name)
    const to = after.get(name)
    const group = pseudo('group', name)
    if (kind === 'still') {
      continue
    }
    if (from !== undefined && to !== undefined) {
      const scale =
        kind === 'grow' && to.width > 0 && to.height > 0
          ? ` scale(${from.width / to.width}, ${from.height / to.height})`
          : ''
      run(
        group,
        [{ transform: `${place(from)}${scale}` }, { transform: place(to) }],
        { duration: MOVE_MS }
      )
      // The video's old snapshot is a still frame: the live one takes over quickly, so a moving picture never
      // doubles; the rest cross-fade over the whole move
      const fade = {
        duration: name === 'theater-video' ? VIDEO_FADE_MS : MOVE_MS,
      }
      run(pseudo('old', name), [{ opacity: 1 }, { opacity: 0 }], fade)
      run(pseudo('new', name), [{ opacity: 0 }, { opacity: 1 }], fade)
      continue
    }
    // A panel in one layout only: it closes or opens where it stands, from (or to) a little smaller, about its
    // centre on the way out and its top on the way in, so it grows down from under what sits above it
    const box = from ?? to
    if (box === undefined) {
      continue
    }
    const shrunk = (originY: number) =>
      `translate(${box.left + (box.width * (1 - PANEL_SCALE)) / 2}px, ${box.top + box.height * (1 - PANEL_SCALE) * originY}px) scale(${PANEL_SCALE})`
    if (from === undefined) {
      const open = { delay: OPEN_DELAY_MS, duration: OPEN_MS }
      run(group, [{ transform: shrunk(0) }, { transform: place(box) }], open)
      run(pseudo('new', name), [{ opacity: 0 }, { opacity: 1 }], open)
    } else {
      run(group, [{ transform: place(box) }, { transform: shrunk(0.5) }], {
        duration: CLOSE_MS,
        easing: 'ease-out',
      })
      run(pseudo('old', name), [{ opacity: 1 }, { opacity: 0 }], {
        duration: CLOSE_MS,
        easing: 'ease-out',
      })
    }
  }
}

// Runs `update` (the layout's state change) as Theater Mode's transition
export const transitionTheater = (update: () => void) => {
  if (typeof document.startViewTransition !== 'function') {
    update()
    return
  }
  const root = document.documentElement
  if (reducedMotion()) {
    // The page as a whole cross-fades: nothing moves
    root.dataset.theaterMove = 'fade'
    const transition = document.startViewTransition(() => {
      flushSync(update)
      placeEngineNow()
    })
    const settle = async () => {
      try {
        await transition.finished
      } finally {
        delete root.dataset.theaterMove
      }
    }
    void settle()
    return
  }
  const named = new Map<Element, Named>()
  nameParts(named)
  const before = boxes(named)
  root.dataset.theaterMove = 'move'
  let after = new Map<string, DOMRect>()
  const transition = document.startViewTransition(() => {
    // The old layout's names leave with the elements that leave; the ones that stay keep theirs
    flushSync(update)
    // The video's layer is placed by a ResizeObserver: placed now, so the new snapshot has it where it ends
    placeEngineNow()
    nameParts(named)
    after = boxes(named)
  })
  const run = async () => {
    try {
      await transition.ready
      animate([...named.values()], before, after)
    } catch {
      // Skipped (a second toggle before this one started): the layout is already in place
    }
  }
  const settle = async () => {
    try {
      await transition.finished
    } finally {
      unname(named)
      delete root.dataset.theaterMove
    }
  }
  void run()
  void settle()
}
