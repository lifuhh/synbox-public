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
