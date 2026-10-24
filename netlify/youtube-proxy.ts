// The YouTube Data API key stays on the server. The browser asks for one of a fixed set of reads, so
// the proxy can never be used to spend the key's quota on anything else.
// Shared by the Netlify function (deployed) and the Vite dev server (local).

import { z } from 'zod'

const API = 'https://www.googleapis.com/youtube/v3'

// The YouTube Top 100 Songs Japan chart
const PLAYLISTS = new Set(['PL4fGSI1pDJn4-UIb6RKHdxam-oAUULIGB'])
const VIDEO_ID = /^[\w-]{11}$/u
const PAGE_TOKEN = /^[\w-]{1,64}$/u

// The CDN keeps answers so most visits cost no quota; browsers keep them briefly. Durable: one copy for every
// edge node, or each node asks YouTube again (about 2 s for the chart)
const cacheHeaders = (cdnSeconds: number) => ({
  'Cache-Control': 'public, max-age=300',
  'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${cdnSeconds}, stale-while-revalidate=86400`,
})

const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  Response.json(body, { headers, status })

const upstreamUrl = (path: string, search: URLSearchParams) => {
  const playlist = /^\/api\/youtube\/playlist\/(?<id>[\w-]+)$/u.exec(path)
    ?.groups?.id
  if (playlist !== undefined && PLAYLISTS.has(playlist)) {
    const pageToken = search.get('pageToken')
    const params = new URLSearchParams({
      maxResults: '50',
      part: 'snippet',
      playlistId: playlist,
    })
    if (pageToken !== null && PAGE_TOKEN.test(pageToken)) {
      params.set('pageToken', pageToken)
    }
    return {
      cdnSeconds: 60 * 60,
      statistics: true,
      url: `${API}/playlistItems?${params}`,
    }
  }
  const video = /^\/api\/youtube\/video\/(?<id>[\w-]+)$/u.exec(path)?.groups?.id
  if (video !== undefined && VIDEO_ID.test(video)) {
    const params = new URLSearchParams({
      id: video,
      part: 'snippet,statistics,contentDetails',
    })
    return { cdnSeconds: 60 * 60 * 24, url: `${API}/videos?${params}` }
  }
  return null
}

const playlistIds = z.object({
  items: z.array(
    z.object({
      snippet: z.object({ resourceId: z.object({ videoId: z.string() }) }),
    })
  ),
})
const videoCounts = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      statistics: z.object({ viewCount: z.string().optional() }).default({}),
    })
  ),
})

// The chart's rows show views, which playlist items don't carry: one videos read per page (1 quota
// unit, its 50 ids), cached with the page. Without it the page still answers, with no counts
const withStatistics = async (body: unknown, key: string, headers: Headers) => {
  const page = playlistIds.safeParse(body)
  const ids = (page.data?.items ?? [])
    .map((item) => item.snippet.resourceId.videoId)
    .filter((id) => VIDEO_ID.test(id))
  if (ids.length === 0 || typeof body !== 'object' || body === null) {
    return body
  }
  const params = new URLSearchParams({ id: ids.join(','), part: 'statistics' })
  const videos = await fetch(
    `${API}/videos?${params}&key=${encodeURIComponent(key)}`,
    { headers }
  ).catch(() => null)
  const counts = videoCounts.safeParse(
    videos?.ok === true ? await videos.json().catch(() => null) : null
  )
  if (!counts.success) {
    return body
  }
  const statistics = Object.fromEntries(
    counts.data.items.map((video) => [
      video.id,
      { viewCount: video.statistics.viewCount },
    ])
  )
  return { ...body, statistics }
}

export const handleYoutube = async (
  request: Request,
  key: string | undefined
): Promise<Response> => {
  if (request.method !== 'GET') {
    return json(405, { error: 'Method not allowed' })
  }
  const { pathname, searchParams } = new URL(request.url)
  const target = upstreamUrl(pathname, searchParams)
  if (target === null) {
    return json(404, { error: 'Not found' })
  }
  if (key === undefined || key === '') {
    return json(503, { error: 'YOUTUBE_API_KEY is not set' })
  }
  const headers = new Headers()
  // A key restricted to website referrers (as in local dev) still sees the page that asked
  const referer = request.headers.get('referer')
  if (referer !== null) {
    headers.set('referer', referer)
  }
  const upstream = await fetch(`${target.url}&key=${encodeURIComponent(key)}`, {
    headers,
  })
  const body: unknown = await upstream.json()
  // Errors pass through with their status but are never cached
  if (!upstream.ok) {
    return json(upstream.status, body, { 'Cache-Control': 'no-store' })
  }
  const answer =
    'statistics' in target ? await withStatistics(body, key, headers) : body
  return json(200, answer, cacheHeaders(target.cdnSeconds))
}
