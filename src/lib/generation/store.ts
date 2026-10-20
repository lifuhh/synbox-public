// The lyrics generations the app runs. They live outside React so they carry on across pages; components
// read them with useGeneration(). Up to MAX_RUNNING run at once and later ones wait their turn here; on the
// backend, songs take turns on the CPU and each hears how many songs are ahead of it.

import { useSyncExternalStore } from 'react'

import type { Phase } from './plan'
import type { Runs } from './progress'
import {
  beginStage,
  completePhase,
  reportFraction,
  startPhase,
} from './progress'
import type { ProgressEvent, SaveOutcome, VideoSummary } from './stream'
import { GenerationError, transcribe, translate, validate } from './stream'

export type GenerationMode = 'new' | 'regenerate'

export type JobStatus =
  // Started after MAX_RUNNING others; runs when one of them ends
  | { kind: 'waiting' }
  | { kind: 'running'; phase: Phase }
  | { kind: 'complete'; at: number; outcome: SaveOutcome }
  | { kind: 'failed'; at: number; message: string }

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
  id: number
  startedAt: number
  video: VideoSummary | null
  runs: Runs
  status: JobStatus
  // Songs ahead of this one on the backend while it waits for the CPU; 0 when it is not waiting
  ahead: number
}

export interface GenerationState {
  // In the order they were started
  jobs: readonly Job[]
  // The job the panel or the corner button shows
  focusedId: number | null
  expanded: boolean
}

const RETRIES = 2
// Coming back from the background reconnects without using a retry, but never without limit: a backend
// that cannot replay would otherwise run (and charge for) the job again on every return
const RECONNECTS = 6
const RETRY_DELAY_MS = 1500
// Each running job holds a stream open; more than this wait here rather than fill the backend's line, which
// refuses songs past its own limit
export const MAX_RUNNING = 3

let state: GenerationState = { expanded: false, focusedId: null, jobs: [] }
const controllers = new Map<number, AbortController>()
let nextId = 1
const listeners = new Set<() => void>()

const set = (next: GenerationState) => {
  state = next
  for (const listener of listeners) {
    listener()
  }
}

// Applies `change` only while job `id` is still listed
const updateJob = (id: number, change: (job: Job) => Job) => {
  if (state.jobs.some((job) => job.id === id)) {
    set({
      ...state,
      jobs: state.jobs.map((job) => (job.id === id ? change(job) : job)),
    })
  }
}

export const focusedJob = ({ jobs, focusedId }: GenerationState) =>
  jobs.find((job) => job.id === focusedId) ?? null

const onProgress = (id: number) => (event: ProgressEvent) => {
  const now = Date.now()
  updateJob(id, (job) => {
    let runs = beginStage(job.runs, event.stage, now, {
      expectedS: event.expectedS,
      label: event.label,
    })
    if (event.fraction !== undefined) {
      runs = reportFraction(runs, event.stage, event.fraction, now)
    }
    return { ...job, runs }
  })
}

// Retries wait for the page to be on screen: a suspended page cannot reach the backend
const untilVisible = async (signal: AbortSignal) => {
  await new Promise<void>((resolve) => {
    if (document.visibilityState === 'visible' || signal.aborted) {
      resolve()
      return
    }
    const settle = () => {
      if (document.visibilityState === 'visible' || signal.aborted) {
        document.removeEventListener('visibilitychange', settle)
        signal.removeEventListener('abort', settle)
        resolve()
      }
    }
    document.addEventListener('visibilitychange', settle)
    signal.addEventListener('abort', settle)
  })
}

const sleep = async (ms: number, signal: AbortSignal) => {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

// Runs one phase; a dropped connection asks again, which attaches to the backend's running job
const runPhase = async <T>(
  id: number,
  phase: Phase,
  signal: AbortSignal,
  call: () => Promise<T>
): Promise<T> => {
  updateJob(id, (job) => ({
    ...job,
    runs: startPhase(job.runs, phase, Date.now()),
    status: { kind: 'running', phase },
  }))
  let attempt = 0
  let reconnects = 0
  for (;;) {
    try {
      const result = await call()
      updateJob(id, (job) => ({
        ...job,
        runs: completePhase(job.runs, phase, Date.now()),
      }))
      return result
    } catch (error) {
      if (!(error instanceof GenerationError) || signal.aborted) {
        throw error
      }
      // Coming back from the background is not a failure: reconnect at once, without using a retry
      if (error.resumed) {
        reconnects += 1
        if (reconnects > RECONNECTS) {
          throw new GenerationError(
            'Lost the connection to the lyrics server too many times',
            false
          )
        }
      } else {
        if (!error.retryable || attempt >= RETRIES) {
          throw error
        }
        attempt += 1
        await sleep(RETRY_DELAY_MS, signal)
      }
      await untilVisible(signal)
    }
  }
}

const run = async (job: Job, signal: AbortSignal) => {
  const { id, videoId } = job
  const progress = onProgress(id)
  try {
    const video = await runPhase(id, 'validate', signal, () =>
      validate(videoId, signal, progress)
    )
    updateJob(id, (current) => ({ ...current, video }))
    await runPhase(id, 'transcribe', signal, () =>
      transcribe(
        videoId,
        {
          regenerate: job.mode === 'regenerate',
          requestId: job.requestId,
          skipUploaderLyrics: job.skipUploaderLyrics,
        },
        signal,
        progress,
        (ahead) => {
          updateJob(id, (current) => ({ ...current, ahead }))
        }
      )
    )
    updateJob(id, (current) => ({ ...current, ahead: 0 }))
    const outcome = await runPhase(id, 'translate', signal, () =>
      translate(videoId, job.requestId, signal, progress)
    )
    updateJob(id, (current) => ({
      ...current,
      status: { at: Date.now(), kind: 'complete', outcome },
    }))
  } catch (error) {
    if (signal.aborted) {
      return
    }
    const message =
      error instanceof Error ? error.message : 'Something went wrong'
    updateJob(id, (current) => ({
      ...current,
      ahead: 0,
      status: { at: Date.now(), kind: 'failed', message },
    }))
  }
}

// Not finished yet: running, or waiting for a free slot
export const isActive = (job: Job | null) =>
  job !== null &&
  (job.status.kind === 'running' || job.status.kind === 'waiting')

export const anyActive = ({ jobs }: GenerationState) => jobs.some(isActive)

// Starts the waiting jobs, oldest first, while fewer than MAX_RUNNING run
const pump = () => {
  for (const job of state.jobs) {
    if (controllers.size >= MAX_RUNNING) {
      return
    }
    if (job.status.kind === 'waiting' && !controllers.has(job.id)) {
      const controller = new AbortController()
      controllers.set(job.id, controller)
      updateJob(job.id, (current) => ({
        ...current,
        startedAt: Date.now(),
        status: { kind: 'running', phase: 'validate' },
      }))
      const started = state.jobs.find((current) => current.id === job.id)
      if (started) {
        void (async () => {
          await run(started, controller.signal)
          controllers.delete(job.id)
          pump()
        })()
      }
    }
  }
}

// Adds a generation and opens its panel. A song already generating is opened instead, and this returns false.
export const startGeneration = (request: GenerationRequest): boolean => {
  const same = state.jobs.find(
    (job) => isActive(job) && job.videoId === request.videoId
  )
  if (same) {
    set({ ...state, expanded: true, focusedId: same.id })
    return false
  }
  const job: Job = {
    ahead: 0,
    id: nextId++,
    runs: {},
    skipUploaderLyrics: false,
    startedAt: Date.now(),
    status: { kind: 'waiting' },
    title: '',
    video: null,
    ...request,
    requestId: request.requestId ?? crypto.randomUUID(),
  }
  // A finished run of the same song gives way to the new one
  const kept = state.jobs.filter(
    (current) => isActive(current) || current.videoId !== job.videoId
  )
  set({ expanded: true, focusedId: job.id, jobs: [...kept, job] })
  pump()
  return true
}

const newest = (jobs: readonly Job[]) =>
  jobs.length > 0 ? jobs[jobs.length - 1].id : null

// Takes job `id` off the list; the panel moves on to the newest job still going, else the newest left
const remove = (id: number) => {
  const jobs = state.jobs.filter((job) => job.id !== id)
  let next = state.focusedId
  if (next === id) {
    const active = jobs.filter(isActive)
    next = newest(active.length > 0 ? active : jobs)
  }
  set({ expanded: next !== null && state.expanded, focusedId: next, jobs })
}

export const retryGeneration = (id: number) => {
  const job = state.jobs.find((current) => current.id === id)
  if (job && job.status.kind === 'failed') {
    remove(id)
    startGeneration({
      mode: job.mode,
      requestId: job.requestId,
      skipUploaderLyrics: job.skipUploaderLyrics,
      title: job.video?.title ?? job.title,
      videoId: job.videoId,
    })
  }
}

// Stops listening. A backend job already running finishes on its own and saves what it made.
export const cancelGeneration = (id: number) => {
  controllers.get(id)?.abort()
  controllers.delete(id)
  remove(id)
  pump()
}

export const dismissGeneration = (id: number) => {
  const job = state.jobs.find((current) => current.id === id)
  if (job && !isActive(job)) {
    remove(id)
  }
}

export const focusGeneration = (id: number) => {
  if (state.jobs.some((job) => job.id === id)) {
    set({ ...state, expanded: true, focusedId: id })
  }
}

export const setGenerationExpanded = (expanded: boolean) => {
  if (state.focusedId !== null) {
    set({ ...state, expanded })
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const getGenerationState = () => state

export const useGeneration = () =>
  useSyncExternalStore(subscribe, getGenerationState)
