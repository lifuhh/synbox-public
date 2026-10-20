// The YouTube Data API key stays on the server. The browser asks for one of a fixed set of reads, so
// the proxy can never be used to spend the key's quota on anything else.
// Shared by the Netlify function (deployed) and the Vite dev server (local).

const API = 'https://www.googleapis.com/youtube/v3'

// The landing page's recommendations and the YouTube Top 100 Songs Japan chart
const PLAYLISTS = new Set([
  'PLzJ1mqwxogpFxKR72a6M8br_UkLKFQASf',
  'PL4fGSI1pDJn4-UIb6RKHdxam-oAUULIGB',
])
const VIDEO_ID = /^[\w-]{11}$/u
const PAGE_TOKEN = /^[\w-]{1,64}$/u

// The CDN keeps answers so most visits cost no quota; browsers keep them briefly
const cacheHeaders = (cdnSeconds: number) => ({
  'Cache-Control': 'public, max-age=300',
  'Netlify-CDN-Cache-Control': `public, s-maxage=${cdnSeconds}, stale-while-revalidate=86400`,
})

const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  Response.json(body, { headers, status })

const upstreamUrl = (path: string, search: URLSearchParams) => {
  const playlist = /^\/api\/youtube\/playlist\/([\w-]+)$/u.exec(path)?.[1]
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
    return { cdnSeconds: 60 * 60, url: `${API}/playlistItems?${params}` }
  }
  const video = /^\/api\/youtube\/video\/([\w-]+)$/u.exec(path)?.[1]
  if (video !== undefined && VIDEO_ID.test(video)) {
    const params = new URLSearchParams({
      id: video,
      part: 'snippet,statistics,contentDetails',
    })
    return { cdnSeconds: 60 * 60 * 24, url: `${API}/videos?${params}` }
  }
  return null
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
  return upstream.ok
    ? json(200, body, cacheHeaders(target.cdnSeconds))
    : json(upstream.status, body, { 'Cache-Control': 'no-store' })
}
