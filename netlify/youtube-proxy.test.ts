import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { handleYoutube } from './youtube-proxy'

const CHART =
  'https://synbox.io/api/youtube/playlist/PL4fGSI1pDJn4-UIb6RKHdxam-oAUULIGB'
const page = {
  items: [{ snippet: { resourceId: { videoId: 'gcgKUcJKxls' } } }],
}

const stubYoutube = (videos: Response | Error) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/playlistItems?')) {
        return await Promise.resolve(Response.json(page))
      }
      if (videos instanceof Error) {
        throw videos
      }
      return await Promise.resolve(videos)
    })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chart playlist', () => {
  it("carries each video's views, nothing else", async () => {
    stubYoutube(
      Response.json({
        items: [
          {
            id: 'gcgKUcJKxls',
            statistics: { likeCount: '3', viewCount: '12' },
          },
        ],
      })
    )
    const answer = await handleYoutube(new Request(CHART), 'key')
    expect(await answer.json()).toEqual({
      ...page,
      statistics: { gcgKUcJKxls: { viewCount: '12' } },
    })
  })

  it('still answers, without counts, when the counts read fails', async () => {
    stubYoutube(new Error('network'))
    const answer = await handleYoutube(new Request(CHART), 'key')
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual(page)
  })
})

// fetch, stubbed to answer an empty list; its calls show whether YouTube was asked
const asked = () => {
  const fetcher = vi.fn(
    async (_url: string) => await Promise.resolve(Response.json({ items: [] }))
  )
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
const status = async (url: string) => {
  const answer = await handleYoutube(new Request(url), 'key')
  return answer.status
}

describe('query parameters', () => {
  it('answers 400 to a query the app never sends, before asking YouTube', async () => {
    const fetcher = asked()
    const refused = await Promise.all([
      status(`${CHART}?x=1`),
      status(`${CHART}?pageToken=CDIQAA&pageToken=CGQQAA`),
      status(`${CHART}?pageToken=${'a'.repeat(65)}`),
      status(`${CHART}?pageToken=a%20b`),
      status(
        'https://synbox.io/api/youtube/video/gcgKUcJKxls?pageToken=CDIQAA'
      ),
      status('https://synbox.io/api/youtube/video/gcgKUcJKxls?'.concat('cb=1')),
    ])
    expect(refused).toEqual([400, 400, 400, 400, 400, 400])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("answers the app's own requests: the chart with and without a page token, a video with none", async () => {
    const fetcher = asked()
    const answered = await Promise.all([
      status(CHART),
      status(`${CHART}?pageToken=CDIQAA`),
      status('https://synbox.io/api/youtube/video/gcgKUcJKxls'),
    ])
    expect(answered).toEqual([200, 200, 200])
    expect(fetcher.mock.calls[1]?.[0]).toContain('pageToken=CDIQAA')
  })
})
