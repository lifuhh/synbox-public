import { expect, test } from 'vite-plus/test'

import { measuredDrag } from './drag-perf'
import type { DragRecord } from './drag-perf'

const BUDGET = { blockedMs: 10, slowFrames: 8 }
const MOVES = 120

// A drag of MOVES moves whose frames are `slow` gaps of 83ms among 60Hz ones; `stalled`: an idle watch saw a 120ms gap
const drag = (slow: number, stalled = false): DragRecord => ({
  gaps: [
    ...Array.from({ length: slow }, () => 83),
    ...Array.from({ length: MOVES }, () => 16.7),
  ],
  idleGaps: [16.7, stalled ? 120 : 16.7],
  moves: MOVES,
})

const run = async (records: DragRecord[]) => {
  const queue = [...records]
  return await measuredDrag(
    // oxlint-disable-next-line typescript/require-await -- run() is async in the audit
    async () => queue.shift() ?? drag(0),
    BUDGET,
    [],
    'case'
  )
}

test('a drag over budget under load passes on an attempt within budget, and one over on every attempt fails', async () => {
  // 2026-11-27, desktop Chrome beside another session's test run: 10 slow frames, idle watches clean
  expect(await run([drag(10), drag(1)])).toMatchObject({
    over: false,
    redos: 1,
    slowFrames: 1,
  })
  // The regression the audit was written for is slow on every attempt: the least blocked attempt is the verdict
  expect(await run([drag(57), drag(40), drag(50)])).toMatchObject({
    over: true,
    slowFrames: 40,
  })
  expect(await run([drag(57, true), drag(40, true), drag(50, true)])).toBe(null)
})
