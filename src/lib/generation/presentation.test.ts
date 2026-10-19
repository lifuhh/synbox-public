import { describe, expect, test } from 'vite-plus/test'

import {
  advanceCursor,
  BACKLOG_STEP_MS,
  FILL_MS,
  FINAL_HOLD_MS,
  isRevealed,
  START_CURSOR,
  STEP_HOLD_MS,
} from './presentation'
import type { Cursor } from './presentation'
import type { StepView } from './progress'

const view = (state: StepView['state']): StepView => ({
  detail: null,
  fraction: state === 'done' ? 1 : 0.3,
  measured: false,
  slow: false,
  state,
})
const allDone = Array.from({ length: 5 }, () => view('done'))

// Ticks the cursor every 50 ms, as the panel does, and records when each step was centered
const play = (views: StepView[], completedAt: number | null, until: number) => {
  let cursor: Cursor = START_CURSOR
  const centeredAt: number[] = []
  for (let now = 0; now <= until; now += 50) {
    cursor = advanceCursor(cursor, views, completedAt, false, now)
    centeredAt[cursor.index] ??= now
  }
  return { centeredAt, cursor }
}

describe('the step wheel', () => {
  test('rolls through steps that all finished at once, quicker but one full bar at a time', () => {
    const { centeredAt } = play(allDone, 0, 10_000)
    expect(centeredAt).toHaveLength(5)
    const gaps = centeredAt.slice(1).map((at, i) => at - centeredAt[i])
    expect(gaps.every((gap) => gap >= BACKLOG_STEP_MS)).toBe(true)
  })

  test('holds a step that just finished for the full beat when the next is still running', () => {
    const views = [
      view('done'),
      view('active'),
      view('pending'),
      view('pending'),
      view('pending'),
    ]
    const { centeredAt } = play(views, null, 500)
    expect(centeredAt).toHaveLength(1)
    expect(play(views, null, FILL_MS + STEP_HOLD_MS).centeredAt[1]).toBe(
      FILL_MS + STEP_HOLD_MS
    )
  })

  test('waits on a step that is still running', () => {
    const views = [
      view('done'),
      view('active'),
      view('pending'),
      view('pending'),
      view('pending'),
    ]
    expect(play(views, null, 10_000).cursor.index).toBe(1)
  })
})

describe('the result', () => {
  test('shows only after the last step and the job have been at 100 % for the hold', () => {
    const { cursor, centeredAt } = play(allDone, 0, 10_000)
    const revealAt = centeredAt[4] + FILL_MS + FINAL_HOLD_MS
    expect(cursor.revealAt).toBe(revealAt)
    expect(isRevealed(cursor, revealAt - 1)).toBe(false)
    expect(isRevealed(cursor, revealAt)).toBe(true)
  })

  test('never shows while the job is not complete, however long the bars sit full', () => {
    expect(play(allDone, null, 60_000).cursor.revealAt).toBeNull()
  })

  test('waits for a job that completes after the last step filled', () => {
    const { cursor } = play(allDone, 9000, 10_000)
    expect(cursor.revealAt).toBe(9000 + FILL_MS + FINAL_HOLD_MS)
  })
})
