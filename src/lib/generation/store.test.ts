import { beforeEach, expect, test, vi } from 'vite-plus/test'

import {
  cancelGeneration,
  getGenerationState,
  MAX_RUNNING,
  startGeneration,
} from './store'

// Every request hangs until it is aborted, so started jobs stay running
beforeEach(() => {
  vi.stubGlobal('document', {
    addEventListener: () => {},
    removeEventListener: () => {},
    visibilityState: 'visible',
  })
  vi.stubGlobal(
    'fetch',
    async (_url: string, init: RequestInit) =>
      // oxlint-disable-next-line promise/avoid-new -- a fetch that only ends when aborted
      await new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
  )
})

const kinds = () => getGenerationState().jobs.map((job) => job.status.kind)

test('songs past the running limit wait, and start when a slot frees', () => {
  for (const video of ['a', 'b', 'c', 'd']) {
    startGeneration({ mode: 'new', videoId: video.repeat(11) })
  }
  expect(MAX_RUNNING).toBe(3)
  expect(kinds()).toEqual(['running', 'running', 'running', 'waiting'])

  // The same song again opens the one already going instead of adding it twice
  expect(startGeneration({ mode: 'new', videoId: 'b'.repeat(11) })).toBe(false)
  expect(getGenerationState().jobs).toHaveLength(4)

  const { focusedId, jobs } = getGenerationState()
  expect(focusedId).toBe(jobs[1].id)

  // Cancelling the song on screen frees its slot for the waiting one and shows the newest song still going
  cancelGeneration(jobs[1].id)
  expect(kinds()).toEqual(['running', 'running', 'running'])
  expect(getGenerationState().focusedId).toBe(jobs[3].id)
})

vi.mock('@/lib/auth', () => ({
  backendToken: async () => await Promise.resolve(null),
}))

// The player answers 150 for this id, as YouTube does for age-restricted videos
const YOUTUBE_ONLY = 'x8VYWazR5mE'
vi.mock('@/lib/youtube/embed-check', () => ({
  playsOutsideYouTube: async (videoId: string) =>
    await Promise.resolve(videoId !== YOUTUBE_ONLY),
}))

test('a video YouTube keeps to youtube.com fails before the backend is asked, with no retry', async () => {
  vi.resetModules()
  const store = await import('./store')
  const fetchMock = vi.fn(globalThis.fetch)
  vi.stubGlobal('fetch', fetchMock)

  store.startGeneration({ mode: 'new', videoId: YOUTUBE_ONLY })
  await vi.waitFor(() => {
    expect(store.getGenerationState().jobs[0].status.kind).toBe('failed')
  })
  const [job] = store.getGenerationState().jobs
  expect(job.status).toMatchObject({ kind: 'failed', retry: false })
  expect(
    fetchMock.mock.calls.filter(
      ([, init]) =>
        typeof init?.body === 'string' && init.body.includes(YOUTUBE_ONLY)
    )
  ).toEqual([])

  // Any other video still goes to the backend
  store.startGeneration({ mode: 'new', videoId: 'b'.repeat(11) })
  await vi.waitFor(() => {
    expect(fetchMock).toHaveBeenCalled()
  })
})

const ndjson = (lines: object[]) =>
  new Response(`${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, {
    headers: { 'content-type': 'application/x-ndjson' },
  })
const check = (fraction: number) => ({
  data: { expected_s: 5, fraction, stage: 'check' },
  type: 'progress',
})

test('a stream the backend hands over with a resume line is asked again at once, and nothing shows as lost', async () => {
  vi.resetModules()
  const store = await import('./store')
  const asked: string[] = []
  const askedAt: number[] = []
  const hanging = globalThis.fetch
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (!url.endsWith('/validate')) {
      return await hanging(url, init)
    }
    asked.push(typeof init.body === 'string' ? init.body : '')
    askedAt.push(Date.now())
    // The first stream ends after 270 s with the job still running; the next one replays it from the start
    return asked.length === 1
      ? ndjson([
          check(0),
          check(0.5),
          { data: { request_id: 'r' }, type: 'resume' },
        ])
      : ndjson([
          check(0),
          check(0.5),
          check(1),
          {
            data: { full_vid_info: { title: 'Handed Over' } },
            type: 'vid_info',
          },
        ])
  })

  store.startGeneration({ mode: 'new', videoId: 'h'.repeat(11) })
  await vi.waitFor(() => {
    expect(store.getGenerationState().jobs[0].video?.title).toBe('Handed Over')
  })
  const [job] = store.getGenerationState().jobs
  expect(asked).toHaveLength(2)
  expect(asked[1]).toBe(asked[0])
  // At once: not after a retry's wait (1.5 s) or a reconnect's (2 s)
  expect(askedAt[1] - askedAt[0]).toBeLessThan(500)
  expect(JSON.parse(asked[0])).toMatchObject({ resume: true })
  expect(job.status).toMatchObject({ kind: 'running', phase: 'transcribe' })
  expect(job.reconnectingSince).toBeNull()
})
