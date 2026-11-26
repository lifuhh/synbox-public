import { expect, test } from 'vite-plus/test'

import { judgeHide, judgeSwap } from './row-swap'
import type { Frame, Recording } from './row-swap'

// Two buttons in a row, 88px apart: place 1 at x 100, place 2 at x 188
const HOME = { first: 100, second: 188 }
const at = (x: number, y = 50) => ({ h: 40, w: 40, x, y })
const OTHERS = 'Lyrics@52,50,40,40|Swap@148,54,32,32'

interface Drawn {
  /** Where Translations and Romaji are drawn */
  t: number
  r: number
  /** Which button draws Translations (the other draws Romaji) */
  owner?: number
  others?: string
  blockY?: number
  opacity?: number
}

const frame = (i: number, d: Drawn): Frame => ({
  block: { h: 94, w: 600, x: 200, y: d.blockY ?? 469.1 },
  others: d.others ?? OTHERS,
  owners: { Romaji: d.owner === 2 ? 1 : 2, Translations: d.owner ?? 1 },
  parts: { Romaji: at(d.r), Translations: at(d.t) },
  swap: { opacity: d.opacity ?? 1, visibility: 'visible' },
  t: i * 16.7,
})

const FIRST = {
  fillIds: '1,2,3',
  rail: 'Translations > Romaji',
  rowIds: '4,5,6',
  rows: 'japanese > translation > romaji',
}
const SWAPPED = {
  ...FIRST,
  rail: 'Romaji > Translations',
  rows: 'japanese > romaji > translation',
}

// Eased in and out over 14 frames, the other button drawing each part from the click's frame on
const ease = (p: number) => (1 - Math.cos(Math.PI * p)) / 2
const travel = (tweak: (d: Drawn, step: number) => Drawn = (d) => d) => [
  ...[0, 1, 2, 3, 4, 5].map((i) => frame(i, { r: HOME.second, t: HOME.first })),
  ...Array.from({ length: 15 }, (_, step) => {
    const moved = 88 * ease(step / 14)
    return frame(
      6 + step,
      tweak({ owner: 2, r: HOME.second - moved, t: HOME.first + moved }, step)
    )
  }),
  ...[21, 22, 23].map((i) =>
    frame(i, { owner: 2, r: HOME.first, t: HOME.second })
  ),
]

const swap = (frames: Frame[], over: Partial<Recording> = {}): Recording => ({
  after: SWAPPED,
  before: FIRST,
  frames,
  presses: [6],
  ...over,
})

const found = (
  recording: Recording,
  { swaps = 1, reduced = false }: { swaps?: number; reduced?: boolean } = {}
) => {
  const hits: string[] = []
  judgeSwap('case', recording, swaps, reduced, (finding) => {
    hits.push(finding)
  })
  return [...new Set(hits)].toSorted()
}

test('a swap that trades the two parts in place and lands flags nothing', () => {
  expect(found(swap(travel()))).toEqual([])
})

test('each way a swap can go wrong is the count it is named for', () => {
  // The rows traded, the buttons did not
  expect(
    found(swap(travel(), { after: { ...SWAPPED, rail: FIRST.rail } }))
  ).toEqual(['orderMismatches'])
  // Two presses must end where they began
  expect(found(swap(travel()), { swaps: 2 })).toEqual(['orderMismatches'])
  // A row drawn by a new element
  expect(
    found(swap(travel(), { after: { ...SWAPPED, rowIds: '4,5,9' } }))
  ).toEqual(['remounts'])
  // The lyrics' block a fifth of a pixel lower for the travel
  expect(
    found(swap(travel((d, step) => (step > 2 ? { ...d, blockY: 469.3 } : d))))
  ).toEqual(['blockMoves'])
  // Another button drawn elsewhere on one frame
  expect(
    found(
      swap(
        travel((d, step) =>
          step === 5 ? { ...d, others: OTHERS.replace('52,50', '52,58') } : d
        )
      )
    )
  ).toEqual(['neighbourMoves'])
  // From rest, the other button draws the part 5px on
  expect(
    found(
      swap(
        travel((d, step) => (step === 0 ? { ...d, r: d.r - 5, t: d.t + 5 } : d))
      )
    )
  ).toEqual(['buttonJumps'])
  // 4px past its place, then back
  expect(
    found(
      swap(
        travel((d, step) =>
          step === 13 ? { ...d, r: HOME.first - 4, t: HOME.second + 4 } : d
        )
      )
    )
  ).toEqual(['overshoots'])
})

// The travel, then `frames` frames a pixel short of its end before it lands
const tail = (frames: number) =>
  swap([
    ...travel().slice(0, 20),
    ...Array.from({ length: frames }, (_, i) =>
      frame(20 + i, { owner: 2, r: HOME.first + 1, t: HOME.second - 1 })
    ),
    frame(20 + frames, { owner: 2, r: HOME.first, t: HOME.second }),
  ])

test('a part that creeps the last pixel in is a creep, and a tail of two frames is not', () => {
  expect(found(tail(8))).toEqual(['creeps'])
  expect(found(tail(2))).toEqual([])
})

test('a press mid-move hands the part over where it travels, not in place', () => {
  // Turned back at step 5: the first button draws Translations again, one travelling step on from where it was
  const frames = travel().slice(0, 12)
  const last = frames.at(-1)
  const t = last?.parts.Translations?.x ?? 0
  const r = last?.parts.Romaji?.x ?? 0
  const back = [1, 2, 3, 4, 5, 6].map((step) =>
    frame(11 + step, {
      owner: 1,
      r: r + ((HOME.second - r) * step) / 6,
      t: t + ((HOME.first - t) * step) / 6,
    })
  )
  expect(
    found(
      swap([...frames, ...back, frame(18, { r: HOME.second, t: HOME.first })], {
        after: FIRST,
        presses: [6, 12],
      }),
      { swaps: 2 }
    )
  ).toEqual([])
})

test('under Reduce Motion the parts trade at once, and any travel is counted', () => {
  const still = [
    ...[0, 1, 2].map((i) => frame(i, { r: HOME.second, t: HOME.first })),
    ...[3, 4, 5].map((i) =>
      frame(i, { owner: 2, r: HOME.first, t: HOME.second })
    ),
  ]
  expect(found(swap(still, { presses: [3] }), { reduced: true })).toEqual([])
  expect(found(swap(travel()), { reduced: true })).toEqual([
    'reducedMotionMoves',
  ])
})

// A row hidden: the swap's opacity frame by frame, hidden at the end once it reaches 0; `tweak` changes the last frame
const hide = (opacities: number[], tweak: Partial<Frame> = {}) => {
  const frames = opacities.map((opacity, i) => ({
    ...frame(i, { opacity, r: HOME.second, t: HOME.first }),
    ...(i === opacities.length - 1 ? tweak : {}),
  }))
  const last = frames.at(-1)
  if (last?.swap && last.swap.opacity === 0 && tweak.swap === undefined) {
    last.swap.visibility = 'hidden'
  }
  const hits: string[] = []
  judgeHide(
    'case',
    { after: FIRST, before: FIRST, frames, presses: [1] },
    true,
    (finding) => {
      hits.push(finding)
    }
  )
  return [...new Set(hits)].toSorted()
}

test('the swap fades when a row is hidden: at once, left shown, or with a button moved, it is counted', () => {
  expect(hide([1, 1, 0.7, 0.4, 0.1, 0, 0])).toEqual([])
  expect(hide([1, 1, 0, 0, 0])).toEqual(['pops'])
  expect(hide([1, 1, 0.7, 0.4, 0.4])).toEqual(['pops'])
  // Faded out, but still in the tab order
  expect(
    hide([1, 1, 0.7, 0.4, 0.1, 0], {
      swap: { opacity: 0, visibility: 'visible' },
    })
  ).toEqual(['pops'])
  expect(
    hide([1, 1, 0.7, 0.4, 0.1, 0], { others: OTHERS.replace('52,50', '60,50') })
  ).toEqual(['neighbourMoves'])
})
