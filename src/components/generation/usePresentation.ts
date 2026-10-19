import { useEffect, useRef, useState } from 'react'

import { STEPS } from '@/lib/generation/plan'
import type { Cursor } from '@/lib/generation/presentation'
import {
  advanceCursor,
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

interface Tick {
  jobId: number | null
  cursor: Cursor
  now: number
}

const viewsAt = (job: Job, now: number) =>
  STEPS.map((step) => stepView(job.runs, step, now))

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
  const cursor = sameJob ? tick.cursor : START_CURSOR
  const revealed = sameJob && isRevealed(cursor, tick.now)
  const ticking = job !== null && job.status.kind !== 'failed' && !revealed

  useEffect(() => {
    if (!ticking) {
      return undefined
    }
    const step = () => {
      setTick((prev) => {
        const current = jobRef.current
        if (!current) {
          return prev
        }
        const now = Date.now()
        const from = prev.jobId === current.id ? prev.cursor : START_CURSOR
        const { status } = current
        return {
          cursor: advanceCursor(
            from,
            viewsAt(current, now),
            status.kind === 'complete' ? status.at : null,
            status.kind === 'failed',
            now
          ),
          jobId: current.id,
          now,
        }
      })
    }
    step()
    const timer = setInterval(step, TICK_MS)
    return () => {
      clearInterval(timer)
    }
  }, [ticking, job?.id])

  if (!job) {
    return null
  }
  const now = sameJob ? tick.now : job.startedAt
  const views = viewsAt(job, now)
  const failed = job.status.kind === 'failed'
  const lastIndex = views.length - 1
  const brokenIndex = views.findIndex((view) => view.state !== 'done')
  const index = failed
    ? brokenIndex === -1
      ? lastIndex
      : brokenIndex
    : cursor.index
  // 100 % shows once the wheel has reached the last step of a finished job
  const complete = job.status.kind === 'complete' && cursor.index === lastIndex
  return {
    complete,
    index,
    overall: overallValue(job.runs, now, complete),
    remainingS: remainingSeconds(job.runs, now),
    revealed,
    // The centered step shows full while it waits for the wheel to roll
    views,
  }
}

export type Presentation = NonNullable<ReturnType<typeof usePresentation>>
