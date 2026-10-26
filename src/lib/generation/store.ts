// The lyrics generations the app runs. They live outside React so they carry on across pages; components
// read them with useGeneration(). Up to MAX_RUNNING run at once and later ones wait their turn here; on the
// backend, songs take turns on the CPU and each hears how many songs are ahead of it.
//
// Every tab of the browser shares one queue, kept in localStorage: one tab runs it, the others show it and
// send it their commands (tabs.ts). A reload or a new tab finds the songs where they were, and a running
// song carries on from its step by reconnecting with its request id.

import { useSyncExternalStore } from 'react'

import { playsOutsideYouTube } from '@/lib/youtube/embed-check'

import { GenerationError } from './failure'
import type { Phase } from './plan'
import { checkVideo } from './preflight'
import {
  beginStage,
  closeQuickCheck,
  completePhase,
  openQuickCheck,
  overallValue,
  QUICK_CHECK_MS,
  reportFraction,
  startPhase,
} from './progress'
import type { Command, GenerationRequest, Job } from './queue'
import {
  applyCommand,
  decodeJobs,
  encodeJobs,
  isActive,
  STORAGE_KEY,
} from './queue'
import { onResume } from './resume'
import type { Listeners, ProgressEvent, Refusal } from './stream'
import { checkGeneration, transcribe, translate, validate } from './stream'
import { Tabs } from './tabs'

export type { GenerationMode, GenerationRequest, Job, JobStatus } from './queue'
export { isActive } from './queue'

export interface GenerationState {
  // In the order they were started; the same in every tab
  jobs: readonly Job[]
  // The job this tab's panel shows
  focusedId: string | null
  // This tab's top bar panel is open
  expanded: boolean
  // Songs this tab is asking the backend about (requestGeneration), before any job exists
  checking: readonly string[]
  // What this tab's panel found unread (a job's id, a fix's `fix:` key): marked read as the panel opened, each
  // keeps its dot until the panel closes
  unread: readonly string[]
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
// refuses songs past its own limit. One limit for the whole browser: the leading tab runs every song
export const MAX_RUNNING = 3
// The leading tab writes the queue at most this often while progress comes in
const SAVE_MS = 200
// Which tab last took the queue over; a tab frozen while it led must not write over its successor on waking
const LEADER_KEY = 'synbox:generation-leader'
const TAB_ID = crypto.randomUUID()
// A command this tab sent stays applied over the leader's copies this long, until the leader's own write has it
const SENT_MS = 2000

const readStored = () => {
  try {
    return decodeJobs(localStorage.getItem(STORAGE_KEY))
  } catch {
    // No storage (private windows can refuse it): this tab's queue lives only in memory
    return []
  }
}

let state: GenerationState = {
  checking: [],
  expanded: false,
  focusedId: null,
  jobs: readStored(),
  unread: [],
}
const controllers = new Map<string, AbortController>()
// When each job last heard the backend. Kept out of `state`: heartbeats would re-render for nothing
const heardAt = new Map<string, number>()
const listeners = new Set<() => void>()
// Jobs waiting for this page to be on screen before they ask the backend again
let waitingForScreen = 0

const newest = (jobs: readonly Job[]) => jobs.at(-1)?.id ?? null

// Other notifications the panel lists under the songs (src/lib/report-fixes.ts): while there are some, the panel
// stays open when its last song leaves
let otherNotifications = 0
export const setOtherNotifications = (count: number) => {
  otherNotifications = count
}

// The panel keeps its song while it is listed; otherwise it moves on to the newest song still going, else the
// newest left
const withJobs = (jobs: readonly Job[]): GenerationState => {
  let next = state.focusedId
  if (next !== null && !jobs.some((job) => job.id === next)) {
    const active = jobs.filter(isActive)
    next = newest(active.length > 0 ? active : jobs)
  }
  // The panel closes when its list empties. Not on a null focus: a page loaded with songs listed has none
  // until one is picked, and the panel opened on them must stay open as they are marked seen
  return {
    checking: state.checking,
    expanded: (jobs.length > 0 || otherNotifications > 0) && state.expanded,
    focusedId: next,
    jobs,
    unread: state.unread,
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let leading = false

const save = () => {
  clearTimeout(saveTimer)
  saveTimer = undefined
  if (!leading) {
    return
  }
  try {
    if (localStorage.getItem(LEADER_KEY) === TAB_ID) {
      localStorage.setItem(STORAGE_KEY, encodeJobs(state.jobs))
    }
  } catch {
    // Full or refused: the other tabs miss this update, the next one may fit
  }
}

const set = (next: GenerationState) => {
  const jobsChanged = next.jobs !== state.jobs
  state = next
  if (jobsChanged && leading) {
    saveTimer ??= setTimeout(save, SAVE_MS)
  }
  for (const listener of listeners) {
    listener()
  }
}

// Applies `change` only while job `id` is still listed
const updateJob = (id: string, change: (job: Job) => Job) => {
  if (state.jobs.some((job) => job.id === id)) {
    set({
      ...state,
      jobs: state.jobs.map((job) => (job.id === id ? change(job) : job)),
    })
  }
}

export const focusedJob = ({ jobs, focusedId }: GenerationState) =>
  jobs.find((job) => job.id === focusedId) ?? null

const listenersFor = (id: string): Listeners => ({
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
      if (event.stage === 'check' && job.runs.check?.quick === true) {
        return job
      }
      let runs = beginStage(job.runs, event.stage, now, {
        expectedS: event.expectedS,
      })
      if (event.fraction !== undefined) {
        runs = reportFraction(runs, event.stage, event.fraction, now)
      }
      return { ...job, runs }
    })
  },
})

// Set once the tabs are connected, below
let tabs: Tabs<Command> | null = null

// Retries wait for the page to be on screen: a suspended page cannot reach the backend. Resolves to how
// long it waited. Meanwhile a tab that is on screen may take the queue over (tabs.ts)
const untilVisible = async (signal: AbortSignal) => {
  const since = Date.now()
  if (document.visibilityState !== 'visible' && !signal.aborted) {
    waitingForScreen += 1
    tabs?.ping()
    try {
      // oxlint-disable-next-line promise/avoid-new -- turns the visibilitychange and abort events into a promise
      await new Promise<void>((resolve) => {
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
    } finally {
      waitingForScreen -= 1
    }
  }
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
  id: string,
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

// Runs a job from the step it is on: a song taken over from a closed tab carries on where it was, and asking
// for that step again attaches to the backend's job
const run = async (job: Job, signal: AbortSignal) => {
  const { id, videoId } = job
  const from = job.status.kind === 'running' ? job.status.phase : 'validate'
  const progress = listenersFor(id)
  const options = {
    regenerate: job.mode === 'regenerate',
    requestId: job.requestId,
    skipUploaderLyrics: job.skipUploaderLyrics,
  }
  // Asked once per job: a reconnect does not load a player again
  let embeds: Promise<boolean> | null = null
  // A new job's Song Check runs on its own short clock: the button's check already passed (openQuickCheck)
  let quickCheck: ReturnType<typeof setTimeout> | undefined
  if (from === 'validate' && job.runs.check === undefined) {
    const ms =
      QUICK_CHECK_MS.min +
      Math.random() * (QUICK_CHECK_MS.max - QUICK_CHECK_MS.min)
    updateJob(id, (current) => ({
      ...current,
      runs: openQuickCheck(current.runs, Date.now(), ms),
    }))
    quickCheck = setTimeout(() => {
      updateJob(id, (current) => ({
        ...current,
        runs: closeQuickCheck(current.runs, Date.now()),
      }))
    }, ms)
  }
  try {
    if (from === 'validate') {
      const video = await runPhase(id, 'validate', signal, async () => {
        // Before the backend spends minutes on a song our player could never play
        embeds ??= playsOutsideYouTube(videoId, signal)
        if (!(await embeds)) {
          throw new YouTubeOnlyError()
        }
        return await validate(videoId, options, signal, progress)
      })
      updateJob(id, (current) => ({ ...current, video }))
    }
    if (from !== 'translate') {
      await runPhase(id, 'transcribe', signal, async () => {
        await transcribe(videoId, options, signal, progress, (ahead) => {
          updateJob(id, (current) => ({ ...current, ahead }))
        })
      })
      updateJob(id, (current) => ({ ...current, ahead: 0 }))
    }
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
    clearTimeout(quickCheck)
    heardAt.delete(id)
  }
}

export const anyActive = ({ jobs }: GenerationState) => jobs.some(isActive)

// Opens a stream for a job that has none, in the leading tab only; `then` runs when it ends here
const launch = (job: Job, then: () => void) => {
  const controller = new AbortController()
  controllers.set(job.id, controller)
  void (async () => {
    await run(job, controller.signal)
    if (controllers.get(job.id) === controller) {
      controllers.delete(job.id)
      then()
    }
  })()
}

// Starts the waiting jobs, oldest first, while fewer than MAX_RUNNING run
const pump = () => {
  if (!leading) {
    return
  }
  for (const job of state.jobs) {
    if (controllers.size >= MAX_RUNNING) {
      return
    }
    if (job.status.kind === 'waiting' && !controllers.has(job.id)) {
      updateJob(job.id, (current) => ({
        ...current,
        startedAt: Date.now(),
        status: { kind: 'running', phase: 'validate' },
      }))
      const started = state.jobs.find((current) => current.id === job.id)
      if (started) {
        launch(started, pump)
      }
    }
  }
}

// What the leading tab does with a command, from any tab
const apply = (command: Command) => {
  set(withJobs(applyCommand(state.jobs, command)))
  pump()
}

// This tab runs the queue now: it takes the stored queue over and reconnects the songs that were running
const lead = () => {
  leading = true
  try {
    localStorage.setItem(LEADER_KEY, TAB_ID)
  } catch {
    // No storage: nothing to write over either
  }
  const stored = readStored()
  // Nothing stored (no storage, or the first tab ever): this tab's own list stands
  const jobs = stored.length > 0 ? stored : state.jobs
  const now = Date.now()
  set(
    withJobs(
      jobs.map((job) =>
        isActive(job) ? { ...job, reconnectingSince: null } : job
      )
    )
  )
  for (const job of state.jobs) {
    if (job.status.kind === 'running' && !controllers.has(job.id)) {
      // The backend began it, so a dropped connection is a reconnect to its job
      if (Object.values(job.runs).some((stage) => stage?.confirmed)) {
        heardAt.set(job.id, now)
      }
      launch(job, pump)
    }
  }
  pump()
  save()
}

// Another tab took the queue over: this one stops its streams (the backend jobs run on) and shows the copy
const follow = () => {
  leading = false
  clearTimeout(saveTimer)
  saveTimer = undefined
  for (const controller of controllers.values()) {
    controller.abort()
  }
  controllers.clear()
  heardAt.clear()
  set(withJobs(readStored()))
}

const shared = new Tabs<Command>({
  apply,
  busy: () => state.jobs.some(isActive),
  follow,
  lead,
  stalled: () => waitingForScreen > 0,
})
tabs = shared

// Commands this tab sent to the leader lately
const sent: { command: Command; at: number }[] = []

if (typeof window !== 'undefined') {
  // The leader's writes, in every other tab. A copy written before the leader had this tab's latest commands
  // would undo them for a moment (a song just added vanishing from the panel), so they are applied over it
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || leading) {
      return
    }
    const now = Date.now()
    while (sent.length > 0 && now - sent[0].at > SENT_MS) {
      sent.shift()
    }
    let jobs: readonly Job[] = decodeJobs(event.newValue)
    for (const { command } of sent) {
      jobs = applyCommand(jobs, command)
    }
    set(withJobs(jobs))
  })
  // The last progress reaches storage before the next tab takes over
  window.addEventListener('pagehide', save)
}

// Applies a command here at once, so this tab's panel answers the press, and has the leading tab apply it
const send = (command: Command) => {
  if (!leading) {
    sent.push({ at: Date.now(), command })
    set(withJobs(applyCommand(state.jobs, command)))
  }
  shared.send(command)
}

// Whether a start opens the panel by itself: never once the listener moved on (`stayed` false). A song started from
// a link field is one deliberate song, so it opens it every time (`'always'`, the owner, 2026-10-26). One picked
// from a list (`'first'`) opens it only as the first song in progress, or when pressed while already going: a song
// added while others run shows on the ring's count, so picking several in a row doesn't cover the list each time
export type PanelOpening = 'always' | 'first'
export const opensPanel = (
  jobs: readonly Job[],
  videoId: string,
  stayed: boolean,
  opening: PanelOpening
) =>
  stayed &&
  (opening === 'always' ||
    !jobs.some(isActive) ||
    jobs.some((job) => isActive(job) && job.videoId === videoId))

// Adds a generation, and opens the panel on it when `opensPanel` says so. A song already generating is picked
// instead, and this returns false. `stayed`: no input elsewhere since the press that started it
export const startGeneration = (
  request: GenerationRequest,
  {
    stayed = true,
    opening = 'first',
  }: { stayed?: boolean; opening?: PanelOpening } = {}
): boolean => {
  const expanded =
    state.expanded || opensPanel(state.jobs, request.videoId, stayed, opening)
  const same = state.jobs.find(
    (job) => isActive(job) && job.videoId === request.videoId
  )
  if (same) {
    set({ ...state, expanded, focusedId: same.id })
    return false
  }
  const job: Job = {
    ahead: 0,
    id: crypto.randomUUID(),
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
  set({ ...state, expanded, focusedId: job.id })
  send({ job, replaces: null, type: 'add' })
  return true
}

// What a button calls: asks first, so a song that would be refused never opens the panel. The backend says
// whether it takes the caller's song (quota, sign-in), and a new song's video is checked as the backend would
// (preflight.ts: it exists, its length, it plays outside YouTube); a video refusal comes first, as signing in
// wouldn't help it. Resolves to the refusal, or null once the generation started (or its running job was
// picked). `stayed` is read once the answers are in, which can take seconds while the backend starts up. A
// press on a song already being checked does nothing (`'checking'`): the first press's answer starts it
export const requestGeneration = async (
  request: GenerationRequest,
  stayed: () => boolean = () => true,
  opening: PanelOpening = 'first'
): Promise<Refusal | 'checking' | null> => {
  const { videoId } = request
  if (state.checking.includes(videoId)) {
    return 'checking'
  }
  const running = state.jobs.some(
    (job) => isActive(job) && job.videoId === videoId
  )
  if (!running) {
    set({ ...state, checking: [...state.checking, videoId] })
    const [account, video] = await Promise.all([
      checkGeneration(videoId, request.mode),
      request.mode === 'new'
        ? checkVideo(videoId)
        : Promise.resolve({ refusal: null, title: null }),
    ]).finally(() => {
      set({ ...state, checking: state.checking.filter((id) => id !== videoId) })
    })
    const refusal = video.refusal ?? account
    if (refusal !== null) {
      return refusal
    }
    startGeneration(
      { ...request, title: request.title ?? video.title ?? undefined },
      { opening, stayed: stayed() }
    )
    return null
  }
  startGeneration(request, { opening, stayed: stayed() })
  return null
}

export const retryGeneration = (id: string) => {
  const failed = state.jobs.find((current) => current.id === id)
  if (failed?.status.kind !== 'failed') {
    return
  }
  const job: Job = {
    ...failed,
    ahead: 0,
    id: crypto.randomUUID(),
    reconnectingSince: null,
    runs: {},
    seen: false,
    startedAt: Date.now(),
    status: { kind: 'waiting' },
    title: failed.video?.title ?? failed.title,
    video: null,
  }
  set({ ...state, expanded: true, focusedId: job.id })
  send({ job, replaces: id, type: 'add' })
}

// Stops listening. A backend job already running finishes on its own and saves what it made.
export const dismissGeneration = (id: string) => {
  send({ id, type: 'dismiss' })
}

export const dismissFinishedGenerations = () => {
  send({ type: 'dismiss-all' })
}

export const focusGeneration = (id: string) => {
  if (state.jobs.some((job) => job.id === id)) {
    set({ ...state, expanded: true, focusedId: id })
  }
}

export const setGenerationExpanded = (expanded: boolean) => {
  if (state.expanded !== expanded) {
    set({ ...state, expanded, unread: expanded ? state.unread : [] })
  }
}

// Rows the open panel is marking read, kept unread-looking until it closes (GenerationState.unread)
export const noteUnread = (keys: readonly string[]) => {
  const fresh = keys.filter((key) => !state.unread.includes(key))
  if (fresh.length > 0) {
    set({ ...state, unread: [...state.unread, ...fresh] })
  }
}
export const fixKey = (videoId: string) => `fix:${videoId}`

const isFinished = (job: Job) => !isActive(job)

// Finished songs the listener has not had the panel open on since they finished
export const unseenCount = ({ jobs }: GenerationState) =>
  jobs.filter((job) => isFinished(job) && !job.seen).length

export const markGenerationsSeen = () => {
  const unseen = state.jobs.filter((job) => isFinished(job) && !job.seen)
  if (unseen.length > 0) {
    noteUnread(unseen.map((job) => job.id))
    send({ type: 'seen' })
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

// Where a song stands in this tab: being checked, generating (queued or running), or neither
export const generationPhase = (
  { checking, jobs }: GenerationState,
  videoId: string
): 'checking' | 'generating' | null => {
  if (checking.includes(videoId)) {
    return 'checking'
  }
  return jobs.some((job) => isActive(job) && job.videoId === videoId)
    ? 'generating'
    : null
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
