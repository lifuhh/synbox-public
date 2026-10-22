// The lyrics generations the app runs. They live outside React so they carry on across pages; components
// read them with useGeneration(). Up to MAX_RUNNING run at once and later ones wait their turn here; on the
// backend, songs take turns on the CPU and each hears how many songs are ahead of it.

import { useSyncExternalStore } from 'react'

import { playsOutsideYouTube } from '@/lib/youtube/embed-check'
import type { KaraokeDoc } from '@/types'

import { GenerationError } from './failure'
import type { Phase } from './plan'
import type { Runs } from './progress'
import {
  beginStage,
  completePhase,
  overallValue,
  reportFraction,
  startPhase,
} from './progress'
import { onResume } from './resume'
import type {
  Listeners,
  ProgressEvent,
  Refusal,
  SaveOutcome,
  VideoSummary,
} from './stream'
import { checkGeneration, transcribe, translate, validate } from './stream'

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
  id: number
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

export interface GenerationState {
  // In the order they were started
  jobs: readonly Job[]
  // The job the panel shows
  focusedId: number | null
  // The top bar's panel is open
  expanded: boolean
}

const RETRIES = 2
const RETRY_DELAY_MS = 1500
// A lost connection is not a failure while the backend's job may still be running: it is asked again, with
// waits that grow to the last of these, and each answer replays the job's progress. Asking again never
// pays twice (the request id names the job). Coming back to the page reconnects at once. Cloud Run turning
// requests away while songs use the CPU (429 "Rate exceeded.") counts as lost too: the job runs on
const RECONNECT_DELAYS_MS = [2000, 4000, 8000, 15_000, 30_000]
// How long on screen a job keeps asking without hearing the backend before it says it lost it
const RECONNECT_WINDOW_MS = 10 * 60_000
// Each running job holds a stream open; more than this wait here rather than fill the backend's line, which
// refuses songs past its own limit
export const MAX_RUNNING = 3

let state: GenerationState = { expanded: false, focusedId: null, jobs: [] }
const controllers = new Map<number, AbortController>()
// When each job last heard the backend. Kept out of `state`: heartbeats would re-render for nothing
const heardAt = new Map<number, number>()
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

const listenersFor = (id: number): Listeners => ({
  onHeard: () => {
    heardAt.set(id, Date.now())
    if (
      state.jobs.some((job) => job.id === id && job.reconnectingSince !== null)
    ) {
      updateJob(id, (job) => ({ ...job, reconnectingSince: null }))
    }
  },
  onProgress: (event: ProgressEvent) => {
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
  },
})

// Retries wait for the page to be on screen: a suspended page cannot reach the backend. Resolves to how
// long it waited
const untilVisible = async (signal: AbortSignal) => {
  const since = Date.now()
  // oxlint-disable-next-line promise/avoid-new -- turns the visibilitychange and abort events into a promise
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
  return Date.now() - since
}

// Waits `ms`, or less when the page gets its network back (resume.ts)
const sleep = async (ms: number, signal: AbortSignal) => {
  // oxlint-disable-next-line promise/avoid-new -- turns setTimeout into a promise; Promise.withResolvers is ES2024
  await new Promise<void>((resolve) => {
    const stops: (() => void)[] = []
    const done = () => {
      for (const stop of stops) {
        stop()
      }
      resolve()
    }
    const timer = setTimeout(done, ms)
    stops.push(() => {
      clearTimeout(timer)
    }, onResume(done))
    signal.addEventListener('abort', done)
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
  // When the backend was last heard or this run of reconnects began, moved on by time in the background
  let lostSince: number | null = null
  for (;;) {
    const askedAt = Date.now()
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- attempts run one after another
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
      // Asked again at once, or when the page is back on screen. The replay repeats the job's progress
      // from the start, which only ever raises what the panel shows
      if (error.handoff) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- the next stream waits for the page to be on screen
        await untilVisible(signal)
        continue
      }
      // Before the backend was ever heard there is no job of ours to lose: a few retries, as for any failure
      if (error.lost && heardAt.has(id)) {
        const now = Date.now()
        if (lostSince === null || (heardAt.get(id) ?? 0) >= askedAt) {
          reconnects = 0
          lostSince = now
        }
        if (!error.resumed) {
          reconnects += 1
        }
        if (now - lostSince > RECONNECT_WINDOW_MS) {
          throw new GenerationError(
            'Lost the connection to the lyrics server. The song may still finish there, so try again in a minute.',
            { code: 'connection_lost' }
          )
        }
        updateJob(id, (job) => ({
          ...job,
          reconnectingSince: job.reconnectingSince ?? Date.now(),
        }))
        if (!error.resumed) {
          const delay =
            RECONNECT_DELAYS_MS[
              Math.min(reconnects, RECONNECT_DELAYS_MS.length) - 1
            ]
          // oxlint-disable-next-line eslint/no-await-in-loop -- a reconnect waits before the next attempt
          await sleep(delay, signal)
        }
      } else {
        if (!error.retryable || attempt >= RETRIES) {
          throw error
        }
        attempt += 1
        // oxlint-disable-next-line eslint/no-await-in-loop -- a retry waits before the next attempt
        await sleep(RETRY_DELAY_MS, signal)
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- a retry waits for the page to be on screen
      const away = await untilVisible(signal)
      if (lostSince !== null) {
        lostSince += away
      }
    }
  }
}

class YouTubeOnlyError extends Error {
  constructor() {
    super(
      "YouTube only lets this video play on youtube.com (it's age-restricted), so it can't play here. Try another upload of this song."
    )
    this.name = 'YouTubeOnlyError'
  }
}

// The backend refused to run a job again because it already saved it, as when the page was away while it
// finished and the replay window passed: the song is there to play
const ALREADY_FINISHED = 'already_finished'

const run = async (job: Job, signal: AbortSignal) => {
  const { id, videoId } = job
  const progress = listenersFor(id)
  const options = {
    regenerate: job.mode === 'regenerate',
    requestId: job.requestId,
    skipUploaderLyrics: job.skipUploaderLyrics,
  }
  // Asked once per job: a reconnect does not load a player again
  let embeds: Promise<boolean> | null = null
  try {
    const video = await runPhase(id, 'validate', signal, async () => {
      // Before the backend spends minutes on a song our player could never play
      embeds ??= playsOutsideYouTube(videoId, signal)
      if (!(await embeds)) {
        throw new YouTubeOnlyError()
      }
      return await validate(videoId, options, signal, progress)
    })
    updateJob(id, (current) => ({ ...current, video }))
    await runPhase(id, 'transcribe', signal, async () => {
      await transcribe(videoId, options, signal, progress, (ahead) => {
        updateJob(id, (current) => ({ ...current, ahead }))
      })
    })
    updateJob(id, (current) => ({ ...current, ahead: 0 }))
    const { outcome, karaoke } = await runPhase(
      id,
      'translate',
      signal,
      async () => await translate(videoId, job.requestId, signal, progress)
    )
    updateJob(id, (current) => ({
      ...current,
      reconnectingSince: null,
      status: { at: Date.now(), karaoke, kind: 'complete', outcome },
    }))
  } catch (error) {
    if (signal.aborted) {
      return
    }
    const code = error instanceof GenerationError ? error.code : undefined
    if (code === ALREADY_FINISHED) {
      const now = Date.now()
      updateJob(id, (current) => ({
        ...current,
        ahead: 0,
        reconnectingSince: null,
        runs: completePhase(current.runs, 'translate', now),
        status: {
          at: now,
          karaoke: null,
          kind: 'complete',
          outcome: { kind: 'finished' },
        },
      }))
      return
    }
    const message =
      error instanceof Error ? error.message : 'Something went wrong'
    updateJob(id, (current) => ({
      ...current,
      ahead: 0,
      reconnectingSince: null,
      status: {
        at: Date.now(),
        code,
        kind: 'failed',
        message,
        retry:
          !(error instanceof YouTubeOnlyError) &&
          (code === undefined || code === 'connection_lost'),
      },
    }))
  } finally {
    heardAt.delete(id)
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
  const id = nextId
  nextId += 1
  const job: Job = {
    ahead: 0,
    id,
    reconnectingSince: null,
    runs: {},
    seen: false,
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

// What a button calls: asks the backend first, so a refused song never opens the panel. Resolves to the
// refusal, or null once the generation started (or its running job was opened)
export const requestGeneration = async (
  request: GenerationRequest
): Promise<Refusal | null> => {
  const running = state.jobs.some(
    (job) => isActive(job) && job.videoId === request.videoId
  )
  if (!running) {
    const refusal = await checkGeneration(request.videoId, request.mode)
    if (refusal !== null) {
      return refusal
    }
  }
  startGeneration(request)
  return null
}

const newest = (jobs: readonly Job[]) => jobs.at(-1)?.id ?? null

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
  if (state.expanded !== expanded) {
    set({ ...state, expanded })
  }
}

const isFinished = (job: Job) => !isActive(job)

// Finished songs the listener has not had the panel open on since they finished
export const unseenCount = ({ jobs }: GenerationState) =>
  jobs.filter((job) => isFinished(job) && !job.seen).length

export const markGenerationsSeen = () => {
  if (state.jobs.some((job) => isFinished(job) && !job.seen)) {
    set({
      ...state,
      jobs: state.jobs.map((job) =>
        isFinished(job) && !job.seen ? { ...job, seen: true } : job
      ),
    })
  }
}

// The song the top bar's ring follows while songs generate: of those running, the one that started running
// first (the head of the line), and of several that started at the same moment the one furthest along. While
// all of them still wait for a slot, the first in line. Null when nothing is in progress
export const leadJob = (jobs: readonly Job[], now: number): Job | null => {
  const running = jobs.filter((job) => job.status.kind === 'running')
  if (running.length === 0) {
    return jobs.find((job) => job.status.kind === 'waiting') ?? null
  }
  const ahead = (job: Job, than: Job) =>
    job.startedAt === than.startedAt
      ? overallValue(job.runs, now, false) > overallValue(than.runs, now, false)
      : job.startedAt < than.startedAt
  let [best] = running
  for (const job of running) {
    if (ahead(job, best)) {
      best = job
    }
  }
  return best
}

export const activeCount = ({ jobs }: GenerationState) =>
  jobs.filter(isActive).length

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const getGenerationState = () => state

export const useGeneration = () =>
  useSyncExternalStore(subscribe, getGenerationState)
