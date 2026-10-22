// The list of generations every tab of the browser shares, and the commands that change it. One tab runs the
// list and keeps it in localStorage (tabs.ts says which); the others show that copy and send it their commands,
// so a reload or a second tab sees the same songs, in the same line.

import type { KaraokeDoc } from '@/types'

import type { Phase } from './plan'
import type { Runs } from './progress'
import type { SaveOutcome, VideoSummary } from './stream'

export type GenerationMode = 'new' | 'regenerate'

export type JobStatus =
  // Started after MAX_RUNNING others; runs when one of them ends
  | { kind: 'waiting' }
  | { kind: 'running'; phase: Phase }
  | {
      kind: 'complete'
      at: number
      outcome: SaveOutcome
      karaoke: KaraokeDoc | null
    }
  // `retry` is false when trying again cannot help, such as a video YouTube keeps to youtube.com or a
  // used-up daily limit; `code` is the backend's reason for refusing (services/accounts.py MESSAGES)
  | {
      kind: 'failed'
      at: number
      message: string
      retry: boolean
      code: string | undefined
    }

export interface GenerationRequest {
  videoId: string
  mode: GenerationMode
  // Leaves the uploader's subtitles out; YouTube Music, LRCLIB and the audio still count
  skipUploaderLyrics?: boolean
  // Shown until the backend sends the song's details
  title?: string
  // A retry keeps its failed job's id, so the backend can hand back a result that finished after all
  requestId?: string
}

// `requestId` is sent with every request of a generation, so a reconnect replays the backend's
// finished job instead of running it again
export interface Job extends Required<GenerationRequest> {
  // Unique across tabs: the tab that adds a job names it
  id: string
  startedAt: number
  video: VideoSummary | null
  runs: Runs
  status: JobStatus
  // Songs ahead of this one on the backend while it waits for the CPU; 0 when it is not waiting
  ahead: number
  // Since when the connection is lost and being asked again, while the backend's job may still be running;
  // null while the backend is heard
  reconnectingSince: number | null
  // Its result was on screen in the panel; a finished job not yet seen counts on the top bar's bell
  seen: boolean
}

// Not finished yet: running, or waiting for a free slot
export const isActive = (job: Job | null) =>
  job !== null &&
  (job.status.kind === 'running' || job.status.kind === 'waiting')

// What any tab asks of the list. Each is safe to apply twice: a command whose answer was slow may be applied
// again by the tab that takes over
export type Command =
  // `replaces`: the failed job a retry takes the place of
  | { type: 'add'; job: Job; replaces: string | null }
  // Stops listening to a song, running or not
  | { type: 'cancel'; id: string }
  // Clears a finished song
  | { type: 'dismiss'; id: string }
  // Clears every finished song
  | { type: 'dismiss-all' }
  // Every finished song was on screen
  | { type: 'seen' }

export const applyCommand = (
  jobs: readonly Job[],
  command: Command
): readonly Job[] => {
  switch (command.type) {
    case 'add': {
      const { job, replaces } = command
      const kept = jobs.filter((current) => current.id !== replaces)
      // Added already, or the song is already going (two tabs pressed at once): one generation of it
      if (
        kept.some(
          (current) =>
            current.id === job.id ||
            (isActive(current) && current.videoId === job.videoId)
        )
      ) {
        return jobs
      }
      // A finished run of the same song gives way to the new one
      return [
        ...kept.filter(
          (current) => isActive(current) || current.videoId !== job.videoId
        ),
        job,
      ]
    }
    case 'cancel': {
      return jobs.some((job) => job.id === command.id)
        ? jobs.filter((job) => job.id !== command.id)
        : jobs
    }
    case 'dismiss': {
      return jobs.some((job) => job.id === command.id && !isActive(job))
        ? jobs.filter((job) => job.id !== command.id)
        : jobs
    }
    case 'dismiss-all': {
      return jobs.some((job) => !isActive(job)) ? jobs.filter(isActive) : jobs
    }
    case 'seen': {
      return jobs.some((job) => !isActive(job) && !job.seen)
        ? jobs.map((job) =>
            !isActive(job) && !job.seen ? { ...job, seen: true } : job
          )
        : jobs
    }
    default: {
      return jobs
    }
  }
}

export const STORAGE_KEY = 'synbox:generations'
// A finished song stays listed (and counted on the bell) this long after it finished: a day until it was on
// screen, then an hour. Songs still running or waiting stay until they finish
const UNSEEN_KEEP_MS = 24 * 60 * 60_000
const SEEN_KEEP_MS = 60 * 60_000

const isFresh = (job: Job, now: number) => {
  if (isActive(job)) {
    return true
  }
  const at =
    job.status.kind === 'complete' || job.status.kind === 'failed'
      ? job.status.at
      : 0
  return now - at < (job.seen ? SEEN_KEEP_MS : UNSEEN_KEEP_MS)
}

export const encodeJobs = (jobs: readonly Job[]) =>
  JSON.stringify({
    jobs: jobs.map((job) =>
      // A saved song's whole karaoke doc is too big to copy on every progress tick; the tabs that read this
      // fetch it like any song
      job.status.kind === 'complete' && job.status.karaoke !== null
        ? { ...job, status: { ...job.status, karaoke: null } }
        : job
    ),
    v: 1,
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const PHASES = new Set<unknown>(['validate', 'transcribe', 'translate'])

const isStatus = (status: unknown): status is JobStatus => {
  if (!isRecord(status)) {
    return false
  }
  switch (status.kind) {
    case 'waiting': {
      return true
    }
    case 'running': {
      return PHASES.has(status.phase)
    }
    case 'complete': {
      return typeof status.at === 'number' && isRecord(status.outcome)
    }
    case 'failed': {
      return (
        typeof status.at === 'number' &&
        typeof status.message === 'string' &&
        typeof status.retry === 'boolean'
      )
    }
    default: {
      return false
    }
  }
}

// Written by another build of the app, or edited by hand: anything not shaped like a job is left out
const isJob = (value: unknown): value is Job =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.requestId === 'string' &&
  typeof value.videoId === 'string' &&
  (value.mode === 'new' || value.mode === 'regenerate') &&
  typeof value.title === 'string' &&
  typeof value.skipUploaderLyrics === 'boolean' &&
  typeof value.startedAt === 'number' &&
  typeof value.ahead === 'number' &&
  typeof value.seen === 'boolean' &&
  (value.reconnectingSince === null ||
    typeof value.reconnectingSince === 'number') &&
  isRecord(value.runs) &&
  (value.video === null ||
    (isRecord(value.video) && typeof value.video.title === 'string')) &&
  isStatus(value.status)

// The stored list as of `now`: unreadable storage reads as no songs, and finished songs past their time drop
export const decodeJobs = (raw: string | null, now: number): Job[] => {
  if (raw === null) {
    return []
  }
  let content: unknown
  try {
    content = JSON.parse(raw)
  } catch {
    return []
  }
  if (!isRecord(content) || content.v !== 1 || !Array.isArray(content.jobs)) {
    return []
  }
  return content.jobs.filter(isJob).filter((job) => isFresh(job, now))
}
