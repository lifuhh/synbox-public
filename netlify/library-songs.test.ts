import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { handleLibrarySongs, type KeptList } from './library-songs'

const LIST = JSON.stringify({
  songs: [{ karaoke: true, title: 'A', video_id: 'gcgKUcJKxls' }],
})
const OLD = JSON.stringify({
  songs: [{ karaoke: false, title: 'B', video_id: 'EaA6NlH80wg' }],
})

const keptList = (initial: string | null) => {
  let body = initial
  const list: KeptList = {
    get: async () => await Promise.resolve(body),
    set: async (next) => {
      body = next
      await Promise.resolve()
    },
  }
  return { list, read: () => body }
}

const settle = async (work: Promise<unknown>[]) => {
  await Promise.all(work)
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('library songs', () => {
  it('answers the live list and keeps it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => await Promise.resolve(new Response(LIST)))
    )
    const kept = keptList(OLD)
    const work: Promise<unknown>[] = []
    const response = await handleLibrarySongs(kept.list, (w) => {
      work.push(w)
    })
    await settle(work)
    expect(await response.text()).toBe(LIST)
    expect(response.headers.get('Netlify-CDN-Cache-Control')).toContain(
      'durable'
    )
    expect(kept.read()).toBe(LIST)
  })

  it('answers the kept list while the service is still loading, briefly cached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          await Promise.resolve(
            Response.json({ error: 'loading' }, { status: 503 })
          )
      )
    )
    const kept = keptList(OLD)
    const response = await handleLibrarySongs(kept.list, () => {
      // The kept list answers; nothing to finish
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(OLD)
    expect(response.headers.get('Netlify-CDN-Cache-Control')).toContain(
      's-maxage=30,'
    )
  })

  it("doesn't wait out a cold start, and keeps the list once it comes", async () => {
    vi.useFakeTimers()
    let wake = (_: Response) => undefined as unknown
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          // oxlint-disable-next-line promise/avoid-new -- a fetch that answers only when the test wakes it
          await new Promise<Response>((resolve) => {
            wake = resolve
          })
      )
    )
    const kept = keptList(OLD)
    const work: Promise<unknown>[] = []
    const answer = handleLibrarySongs(kept.list, (w) => {
      work.push(w)
    })
    await vi.advanceTimersByTimeAsync(2500)
    const response = await answer
    expect(await response.text()).toBe(OLD)
    wake(new Response(LIST))
    await settle(work)
    expect(kept.read()).toBe(LIST)
  })

  it('never keeps an empty or malformed list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => await Promise.resolve(Response.json({ songs: [] })))
    )
    const kept = keptList(null)
    const work: Promise<unknown>[] = []
    const response = await handleLibrarySongs(kept.list, (w) => {
      work.push(w)
    })
    await settle(work)
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(kept.read()).toBeNull()
  })
})
