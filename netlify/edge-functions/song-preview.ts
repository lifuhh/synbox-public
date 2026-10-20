// Link previews (Telegram, WhatsApp, Discord, iMessage...) read the HTML without running the app, so a
// shared /v/ link would only ever say "Synbox". This writes the song's title, channel and thumbnail
// into the page as Open Graph tags. Any failure serves the page unchanged.

import { z } from 'zod'

const VIDEO_PATH = /^\/v\/(?<videoId>[\w-]{11})\/?$/u
const LOOKUP_TIMEOUT_MS = 1500

interface SongPreview {
  channel: string
  thumbnail: string | undefined
  title: string
  url: string
}

const videoResponseSchema = z.object({
  items: z.array(
    z.object({
      snippet: z.object({
        channelTitle: z.string().default(''),
        thumbnails: z
          .record(z.string(), z.object({ url: z.string() }))
          .default({}),
        title: z.string().min(1),
      }),
    })
  ),
})

const THUMBNAIL_SIZES = ['maxres', 'standard', 'high', 'medium', 'default']

const escapeAttribute = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

export const previewFromVideo = (
  body: unknown,
  url: string
): SongPreview | null => {
  const parsed = videoResponseSchema.safeParse(body)
  const snippet = parsed.data?.items[0]?.snippet
  if (snippet === undefined) {
    return null
  }
  const thumbnail = THUMBNAIL_SIZES.map(
    (size) => snippet.thumbnails[size]?.url
  ).find((candidate) => candidate !== undefined && candidate !== '')
  return {
    channel: snippet.channelTitle,
    thumbnail,
    title: snippet.title,
    url,
  }
}

export const injectPreview = (html: string, song: SongPreview) => {
  const description = [
    song.channel,
    'Karaoke with synced lyrics, furigana, romaji and translations',
  ]
    .filter((part) => part !== '')
    .join(' · ')
  const properties: [string, string | undefined][] = [
    ['og:site_name', 'Synbox'],
    ['og:type', 'website'],
    ['og:url', song.url],
    ['og:title', song.title],
    ['og:description', description],
    ['og:image', song.thumbnail],
  ]
  const tags = properties
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(
      ([property, content]) =>
        `<meta property="${property}" content="${escapeAttribute(content)}" />`
    )
  tags.push('<meta name="twitter:card" content="summary_large_image" />')
  return html.replace('</head>', `${tags.join('\n    ')}\n  </head>`)
}

const lookUpSong = async (request: Request, videoId: string) => {
  try {
    // The site's own proxy holds the API key, and its CDN cache answers repeat shares for free
    const response = await fetch(
      new URL(`/api/youtube/video/${videoId}`, request.url),
      { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) }
    )
    if (!response.ok) {
      return null
    }
    // Keeps a shared lyrics style, since some apps open og:url rather than the link that was sent
    const pageUrl = new URL(request.url)
    const style = pageUrl.searchParams.get('style')
    pageUrl.search = style === null ? '' : `?style=${encodeURIComponent(style)}`
    const body: unknown = await response.json()
    return previewFromVideo(body, pageUrl.href)
  } catch {
    return null
  }
}

export default async function songPreview(
  request: Request,
  context: { next: () => Promise<Response> }
) {
  const videoId = VIDEO_PATH.exec(new URL(request.url).pathname)?.groups
    ?.videoId
  if (videoId === undefined) {
    return await context.next()
  }
  const [page, song] = await Promise.all([
    context.next(),
    lookUpSong(request, videoId),
  ])
  const isHtml = page.headers.get('content-type')?.includes('text/html')
  if (song === null || page.status !== 200 || isHtml !== true) {
    return page
  }
  const headers = new Headers(page.headers)
  headers.delete('content-length')
  return new Response(injectPreview(await page.text(), song), {
    headers,
    status: page.status,
  })
}

export const config = { path: '/v/*' }
