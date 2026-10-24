import { QueryClient } from '@tanstack/react-query'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vite-plus/test'

import { librarySongs } from './queries-and-mutations'

const LIST = {
  songs: [
    {
      artist: 'A',
      karaoke: true,
      thumbnail_url: 't',
      title: 'T',
      video_id: 'abcdefghijk',
    },
  ],
}

// Answers `failure` until `untilMs` after the first ask, then the list
const stubFetch = (
  failure: { status: number; retryAfter?: string },
  untilMs: number
) => {
  const times: number[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      times.push(Date.now())
      if (Date.now() - times[0] >= untilMs) {
        return await Promise.resolve(Response.json(LIST))
      }
      const headers =
        failure.retryAfter === undefined
          ? undefined
          : { 'Retry-After': failure.retryAfter }
      return await Promise.resolve(
        Response.json({}, { headers, status: failure.status })
      )
    })
  )
  return times
}

// Starts the gallery's list query; `outcome.settled` says how it ended, null while it still loads
const startLoading = (client: QueryClient) => {
  const outcome: { settled: 'error' | 'success' | null } = { settled: null }
  void (async () => {
    try {
      await client.query(librarySongs)
      outcome.settled = 'success'
    } catch {
      outcome.settled = 'error'
    }
  })()
  return outcome
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the gallery list under a rate limit', () => {
  test('keeps loading through a 60 s rate-limit window and then shows the list', async () => {
    // Netlify blocks an address for the rest of its 60 s window: every ask inside it gets 429
    const times = stubFetch({ status: 429 }, 60_000)
    const outcome = startLoading(new QueryClient())
    await vi.advanceTimersByTimeAsync(59_000)
    expect(outcome.settled).toBe(null)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(outcome.settled).toBe('success')
    // The asks after the first 429 are spread out, not five in 15 s
    expect(
      times.filter((time) => time - times[0] < 15_000).length
    ).toBeLessThanOrEqual(2)
  })

  test('a cold service (503 with Retry-After: 3) is asked again in seconds', async () => {
    const times = stubFetch({ retryAfter: '3', status: 503 }, 1000)
    const outcome = startLoading(new QueryClient())
    await vi.advanceTimersByTimeAsync(3500)
    expect(outcome.settled).toBe('success')
    expect(times[1] - times[0]).toBe(3000)
  })
})
