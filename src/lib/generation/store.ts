// The one lyrics generation the app runs at a time. It lives outside React so it carries on across pages;
// components read it with useGeneration().

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
  | { kind: 'running'; phase: Phase }
  | { kind: 'complete'; at: number; outcome: SaveOutcome }
  | { kind: 'failed'; at: number; message: string }

export interface GenerationRequest {
  videoId: string
  mode: GenerationMode
  // Skips the uploader's lyrics and the saved timing; the lyrics come from the audio
  forceAi?: boolean
  // Shown until the backend sends the song's details
  title?: string
}

export interface Job extends Required<GenerationRequest> {
  id: number
  startedAt: number
  video: VideoSummary | null
  runs: Runs
  status: JobStatus
}

export interface GenerationState {
  job: Job | null
  expanded: boolean
}

const RETRIES = 2
const RETRY_DELAY_MS = 1500

let state: GenerationState = { expanded: false, job: null }
let controller: AbortController | null = null
let nextId = 1
const listeners = new Set<() => void>()

const set = (next: GenerationState) => {
  state = next
  for (const listener of listeners) {
    listener()
  }
}

// Applies `change` only while job `id` is still the current one
const updateJob = (id: number, change: (job: Job) => Job) => {
  if (state.job?.id === id) {
    set({ ...state, job: change(state.job) })
  }
}

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

const sleep = async (ms: number, signal: AbortSignal) =>
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })

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
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await call()
      updateJob(id, (job) => ({
        ...job,
        runs: completePhase(job.runs, phase, Date.now()),
      }))
      return result
    } catch (error) {
      const retry =
        error instanceof GenerationError &&
        error.retryable &&
        attempt < RETRIES &&
        !signal.aborted
      if (!retry) {
        throw error
      }
      await sleep(RETRY_DELAY_MS, signal)
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
      transcribe(videoId, job.forceAi, signal, progress)
    )
    const outcome = await runPhase(id, 'translate', signal, () =>
      translate(videoId, signal, progress)
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
      status: { at: Date.now(), kind: 'failed', message },
    }))
  }
}

export const isRunning = (job: Job | null) => job?.status.kind === 'running'

// Starts a generation and opens its panel. While another one runs, that one's panel opens instead and
// this returns false.
export const startGeneration = (request: GenerationRequest): boolean => {
  if (isRunning(state.job)) {
    set({ ...state, expanded: true })
    return false
  }
  controller?.abort()
  controller = new AbortController()
  const job: Job = {
    forceAi: false,
    id: nextId++,
    runs: {},
    startedAt: Date.now(),
    status: { kind: 'running', phase: 'validate' },
    title: '',
    video: null,
    ...request,
  }
  set({ expanded: true, job })
  void run(job, controller.signal)
  return true
}

export const retryGeneration = () => {
  const { job } = state
  if (job && job.status.kind === 'failed') {
    startGeneration({
      forceAi: job.forceAi,
      mode: job.mode,
      title: job.video?.title ?? job.title,
      videoId: job.videoId,
    })
  }
}

// Stops listening. A backend job already running finishes on its own and saves what it made.
export const cancelGeneration = () => {
  controller?.abort()
  controller = null
  set({ expanded: false, job: null })
}

export const dismissGeneration = () => {
  if (!isRunning(state.job)) {
    set({ expanded: false, job: null })
  }
}

export const setGenerationExpanded = (expanded: boolean) => {
  if (state.job) {
    set({ ...state, expanded })
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useGeneration = () => useSyncExternalStore(subscribe, () => state)
