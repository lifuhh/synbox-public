import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { getChartsPlaylist, getYoutubeVideoInfo } from './api'

const song = (videoId: string, title: string, channel = 'YOASOBI') => ({
  snippet: {
    description: '',
    resourceId: { videoId },
    thumbnails: { high: { url: `https://i.ytimg.com/vi/${videoId}/hq.jpg` } },
    title,
    videoOwnerChannelTitle: channel,
  },
})

// What YouTube returns for a video made private after it joined the playlist
const privateVideo = {
  snippet: {
    description: 'This video is private.',
    resourceId: { videoId: 'gone' },
    thumbnails: {},
    title: 'Private video',
  },
}

const stubFetch = (...bodies: { status?: number; body: unknown }[]) => {
  const urls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url)
      const next = bodies.shift() ?? { body: {} }
      return await Promise.resolve(
        Response.json(next.body, { status: next.status ?? 200 })
      )
    })
  )
  return urls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getChartsPlaylist', () => {
  test('follows the page token and skips private videos', async () => {
    const urls = stubFetch(
      {
        body: {
          items: [song('a', 'Idol'), privateVideo],
          nextPageToken: 'page2',
        },
      },
      { body: { items: [song('b', 'Comet')] } }
    )
    expect(await getChartsPlaylist()).toEqual([
      { id: 'a', title: 'Idol' },
      { id: 'b', title: 'Comet' },
    ])
    expect(urls[0]).not.toContain('pageToken')
    expect(urls[1]).toContain('pageToken=page2')
  })

  test('fails on an error status instead of showing an empty chart', async () => {
    stubFetch({ body: { error: 'quota' }, status: 429 })
    await expect(getChartsPlaylist()).rejects.toThrow('HTTP 429')
  })
})

describe('getYoutubeVideoInfo', () => {
  test('a hidden like count does not fail the lookup', async () => {
    stubFetch({
      body: {
        items: [
          {
            id: 'v1',
            snippet: { channelTitle: 'YOASOBI', title: '優しい彗星' },
            statistics: { commentCount: '3', viewCount: '10' },
          },
        ],
      },
    })
    const info = await getYoutubeVideoInfo('v1')
    expect(info.statistics?.likeCount).toBe('')
    expect(info.duration).toBe('-1')
    expect(info.thumbnail).toBe('https://example.com/placeholder-thumbnail.jpg')
  })

  test('rejects a response without the video list', async () => {
    stubFetch({ body: { kind: 'youtube#videoListResponse' } })
    await expect(getYoutubeVideoInfo('v1')).rejects.toThrow()
  })
})
