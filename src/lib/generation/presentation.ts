// What the screen shows lags what the job knows, so that nothing is skipped: the step wheel rolls one step at
// a time, each finished step shows a full bar first, and the result appears only after 100 % has been on
// screen for a beat. A cached song whose steps all finish at once still rolls through every one.

import type { StepView } from './progress'

// How long the bars' CSS fill transition takes to reach a new value
export const FILL_MS = 450
// A finished step stays full this long before the wheel rolls to the next
export const STEP_HOLD_MS = 450
// With more finished steps queued behind it (a cached song), a full step rolls on after this instead
export const BACKLOG_STEP_MS = 600
// The whole job at 100 % stays this long before the result shows
export const FINAL_HOLD_MS = 1000

export interface Cursor {
  // The step the wheel centers
  index: number
  // When the centered step's bar was first full
  fullSince: number | null
  // When the result may show; set once the last step and the job are both done
  revealAt: number | null
}

export const START_CURSOR: Cursor = {
  fullSince: null,
  index: 0,
  revealAt: null,
}

export const advanceCursor = (
  cursor: Cursor,
  views: readonly StepView[],
  completedAt: number | null,
  failed: boolean,
  now: number
): Cursor => {
  const last = views.length - 1
  if (failed) {
    // Jump to the step that broke; there is nothing to wait for
    const broken = views.findIndex((view) => view.state !== 'done')
    return { ...cursor, index: broken === -1 ? last : broken }
  }
  if (views[cursor.index]?.state !== 'done') {
    return cursor.fullSince === null ? cursor : { ...cursor, fullSince: null }
  }
  const fullSince = cursor.fullSince ?? now
  if (cursor.index < last) {
    const backlog = views[cursor.index + 1].state === 'done'
    if (
      now - fullSince <
      (backlog ? BACKLOG_STEP_MS : FILL_MS + STEP_HOLD_MS)
    ) {
      return { ...cursor, fullSince }
    }
    // The fill of a step that is already done starts the moment it is centered
    const next = cursor.index + 1
    return {
      ...cursor,
      fullSince: views[next].state === 'done' ? now : null,
      index: next,
    }
  }
  if (completedAt === null) {
    return { ...cursor, fullSince }
  }
  return {
    ...cursor,
    fullSince,
    revealAt:
      cursor.revealAt ??
      Math.max(fullSince, completedAt) + FILL_MS + FINAL_HOLD_MS,
  }
}

export const isRevealed = (cursor: Cursor, now: number) =>
  cursor.revealAt !== null && now >= cursor.revealAt
