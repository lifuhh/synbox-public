// The account's songs as the auth Worker's ledger has them (GET /api/me/generations), so every tab and device of a
// signed-in listener lists the same songs going, whichever one asked for them. The backend writes each song's
// stage and fraction there as it runs (services/accounts.py › progress), and the song runs on the backend
// whether or not any page is listening.
//
// A song this browser streams keeps its stream: the ledger only fills in what this browser can't hear. A song
// started elsewhere joins the list as a `mirror` job, moved by the ledger alone, and never opens a stream: asking
// the backend for it with other flags could start (and pay for) a second run.

import { z } from 'zod'

import type { Phase, StageId } from './plan'
import { isStageId, STAGES } from './plan'
import { beginStage, completePhase, reportFraction } from './progress'
import type { Job } from './queue'
import { isActive } from './queue'

const rowSchema = z.object({
  createdAt: z.number(),
  errorCode: z.string().nullable(),
  finishedAt: z.number().nullable(),
  fraction: z.number().nullable(),
  id: z.string(),
  kind: z.string(),
  stage: z.string().nullable(),
  status: z.enum(['reserved', 'running', 'succeeded', 'failed']),
  videoId: z.string(),
})

export type AccountRow = z.infer<typeof rowSchema>

const listSchema = z.object({ generations: z.array(rowSchema) })

// The account's list; empty for a guest. Throws when the Worker can't be reached, so a failed ask changes nothing
export const fetchAccountGenerations = async (
  signal?: AbortSignal
): Promise<AccountRow[]> => {
  const response = await fetch('/api/me/generations', {
    credentials: 'same-origin',
    signal,
  })
  if (!response.ok) {
    throw new Error(`/api/me/generations answered ${response.status}`)
  }
  return listSchema.parse(await response.json()).generations
}

const phaseOf = (stage: StageId): Phase =>
  STAGES.find((spec) => spec.id === stage)?.phase ?? 'validate'

// The backend's reasons a ledger row ended without a song, in the panel's words
const FAILED_TEXT: Record<string, string> = {
  abandoned: 'The lyrics server stopped before this song finished. Try again',
}

// One row's news applied to a job shown from it
const applyRow = (job: Job, row: AccountRow, now: number): Job => {
  if (!isActive(job)) {
    return job
  }
  switch (row.status) {
    case 'reserved': {
      return job
    }
    case 'running': {
      if (row.stage === null || !isStageId(row.stage)) {
        return job
      }
      let runs = beginStage(job.runs, row.stage, now)
      if (row.fraction !== null) {
        runs = reportFraction(runs, row.stage, row.fraction, now)
      }
      return {
        ...job,
        runs,
        status: { kind: 'running', phase: phaseOf(row.stage) },
      }
    }
    case 'succeeded': {
      const at = row.finishedAt ?? now
      return {
        ...job,
        ahead: 0,
        reconnectingSince: null,
        runs: completePhase(job.runs, 'translate', at),
        status: {
          at,
          karaoke: null,
          kind: 'complete',
          outcome: { kind: 'finished' },
        },
      }
    }
    case 'failed': {
      return {
        ...job,
        ahead: 0,
        reconnectingSince: null,
        status: {
          at: row.finishedAt ?? now,
          code: row.errorCode ?? undefined,
          kind: 'failed',
          message:
            FAILED_TEXT[row.errorCode ?? ''] ?? 'Couldn’t generate the lyrics',
          retry: true,
        },
      }
    }
    default: {
      return job
    }
  }
}

const isGoing = (row: AccountRow) =>
  row.status === 'reserved' || row.status === 'running'

// A song this browser streamed and gave up on (it lost the backend for ten minutes) while the ledger still hears
// it, or heard how it ended
const lostHere = (job: Job) =>
  job.status.kind === 'failed' && job.status.code === 'connection_lost'

const mirrorOf = (row: AccountRow): Job => ({
  ahead: 0,
  id: row.id,
  mirror: true,
  mode: row.kind === 'new' ? 'new' : 'regenerate',
  reconnectingSince: null,
  requestId: row.id,
  runs: {},
  seen: false,
  skipUploaderLyrics: false,
  startedAt: row.createdAt,
  status: { kind: 'running', phase: 'validate' },
  title: '',
  video: null,
  videoId: row.videoId,
})

// The list with the account's rows applied. Songs streamed here stay as they are, unless this browser lost one the
// ledger still has; songs shown from the ledger follow it, and leave while still going once it no longer lists
// them (another account signed in, or the song is past the ledger's window); a song going elsewhere that this
// list doesn't have joins it. Finished rows never add a song: one dismissed here would come back
export const mergeAccount = (
  jobs: readonly Job[],
  rows: readonly AccountRow[],
  now: number
): readonly Job[] => {
  const byId = new Map(rows.map((row) => [row.id, row]))
  let changed = false
  const kept: Job[] = []
  for (const job of jobs) {
    const row = byId.get(job.requestId)
    let next = job
    if (job.mirror === true) {
      if (row === undefined) {
        if (isActive(job)) {
          changed = true
          continue
        }
      } else {
        next = applyRow(job, row, now)
      }
    } else if (
      row !== undefined &&
      lostHere(job) &&
      (isGoing(row) || row.status === 'succeeded')
    ) {
      next = applyRow(
        {
          ...job,
          mirror: true,
          status: { kind: 'running', phase: 'validate' },
        },
        row,
        now
      )
    }
    changed ||= next !== job
    kept.push(next)
  }
  const known = new Set(kept.map((job) => job.requestId))
  for (const row of rows) {
    if (
      isGoing(row) &&
      !known.has(row.id) &&
      !kept.some((job) => isActive(job) && job.videoId === row.videoId)
    ) {
      kept.push(applyRow(mirrorOf(row), row, now))
      changed = true
    }
  }
  return changed ? kept : jobs
}
