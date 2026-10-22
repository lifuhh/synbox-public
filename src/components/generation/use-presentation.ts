import { useEffect, useRef, useState } from 'react'

import { STEPS } from '@/lib/generation/plan'
import type { Cursor } from '@/lib/generation/presentation'
import {
  advanceCursor,
  cursorAt,
  isRevealed,
  START_CURSOR,
} from '@/lib/generation/presentation'
import {
  overallValue,
  remainingSeconds,
  stepView,
} from '@/lib/generation/progress'
import type { Job } from '@/lib/generation/store'

const TICK_MS = 100
// A reconnect after coming back usually takes a fraction of a second; only a longer one is worth a word
export const RECONNECTING_NOTICE_MS = 600

export const isReconnecting = (job: Job, now: number) =>
  job.reconnectingSince !== null &&
  now - job.reconnectingSince >= RECONNECTING_NOTICE_MS

interface Tick {
  jobId: string | null
  cursor: Cursor
  now: number
}

const viewsAt = (job: Job, now: number) =>
  STEPS.map((step) => stepView(job.runs, step, now))

const completedAt = ({ status }: Job) =>
  status.kind === 'complete' ? status.at : null

// A job the screen switches to starts at its current step
const firstCursor = (job: Job, now: number) =>
  cursorAt(viewsAt(job, now), completedAt(job), now)

// Re-reads the job on a clock while anything on screen still moves, and works out what to show
export const usePresentation = (job: Job | null) => {
  const [tick, setTick] = useState<Tick>(() => ({
    cursor: START_CURSOR,
    jobId: null,
    now: Date.now(),
  }))
  const jobRef = useRef(job)
  useEffect(() => {
    jobRef.current = job
  })

  const sameJob = job !== null && tick.jobId === job.id
  // Before its first tick a job is read at the current time: read at its start, every bar showed back at
  // its floor for a frame whenever the panel switched songs
  // oxlint-disable-next-line react/purity -- a clock-driven view, read at the same clock its ticks use
  const now = sameJob ? tick.now : Date.now()
  const cursor = sameJob || job === null ? tick.cursor : firstCursor(job, now)
  const revealed = job !== null && isRevealed(cursor, now)
  const ticking = job !== null && job.status.kind !== 'failed' && !revealed

  useEffect(() => {
    const step = () => {
      setTick((prev) => {
        const { current } = jobRef
        if (!current) {
          return prev
        }
        const at = Date.now()
        const from =
          prev.jobId === current.id ? prev.cursor : firstCursor(current, at)
        return {
          cursor: advanceCursor(
            from,
            viewsAt(current, at),
            completedAt(current),
            current.status.kind === 'failed',
            at
          ),
          jobId: current.id,
          now: at,
        }
      })
    }
    const start = () => {
      step()
      const timer = setInterval(step, TICK_MS)
      return () => {
        clearInterval(timer)
      }
    }
    return ticking ? start() : undefined
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a new job restarts the ticker
  }, [ticking, job?.id])

  if (!job) {
    return null
  }
  const views = viewsAt(job, now)
  const failed = job.status.kind === 'failed'
  const lastIndex = views.length - 1
  const brokenIndex = views.findIndex((view) => view.state !== 'done')
  const failedIndex = brokenIndex === -1 ? lastIndex : brokenIndex
  const index = failed ? failedIndex : cursor.index
  // 100 % shows once the wheel has reached the last step of a finished job
  const complete = job.status.kind === 'complete' && cursor.index === lastIndex
  return {
    complete,
    index,
    overall: overallValue(job.runs, now, complete),
    reconnecting: isReconnecting(job, now),
    remainingS: remainingSeconds(job.runs, now),
    revealed,
    // The centered step shows full while it waits for the wheel to roll
    views,
  }
}

export type Presentation = NonNullable<ReturnType<typeof usePresentation>>
