// Every page is the same index.html, so to anything that reads the HTML without running the app (Google, link
// previews in Telegram, WhatsApp, Discord, iMessage...) every page would be the home page. This writes each
// page's own head: a song page gets the song's title, channel and thumbnail and its own canonical address; About,
// Privacy and Terms get their names; the app's personal pages (library, search, account, admin...) and unknown
// paths are kept out of search results. The home page is index.html as built. Any failed lookup serves the page
// without the song's details. Every answer carries the security headers, which netlify.toml's rules don't add to
// a URL an Edge Function handles.

import { z } from 'zod'

import { withSecurityHeaders } from '../security-headers.ts'

const VIDEO_PATH = /^\/v\/(?<videoId>[\w-]{11})\/?$/u
const LOOKUP_TIMEOUT_MS = 1500

const NAMED_PAGES: Record<string, string> = {
  '/about': 'About',
  '/privacy': 'Privacy Policy',
  '/terms': 'Terms of Use',
}

// What a page says about itself; null keeps it out of search results
export interface PageHead {
  canonical: string
  description?: string
  image?: string
  // Where a shared link opens (og:url), when it differs from the canonical address
  shareUrl?: string
  title?: string
}

interface SongPreview {
  channel: string
  thumbnail: string | undefined
  title: string
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

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

export const previewFromVideo = (body: unknown): SongPreview | null => {
  const parsed = videoResponseSchema.safeParse(body)
  const snippet = parsed.data?.items[0]?.snippet
  if (snippet === undefined) {
    return null
  }
  const thumbnail = THUMBNAIL_SIZES.map(
    (size) => snippet.thumbnails[size]?.url
  ).find((candidate) => candidate !== undefined && candidate !== '')
  return { channel: snippet.channelTitle, thumbnail, title: snippet.title }
}

export const songHead = (
  canonical: string,
  shareUrl: string,
  song: SongPreview | null
): PageHead => {
  if (song === null) {
    return { canonical }
  }
  return {
    canonical,
    description: [
      song.channel,
      'Karaoke with synced lyrics, furigana, romaji and translations',
    ]
      .filter((part) => part !== '')
      .join(' · '),
    image: song.thumbnail,
    shareUrl,
    title: `${song.title} · Synbox Karaoke`,
  }
}

const metaTag = (attribute: 'name' | 'property', key: string) =>
  new RegExp(`<meta\\s+${attribute}="${key}"[^>]*>`, 'u')

// Replaces the tag index.html already has, or adds it at the end of the head. A function, not a string, so a
// "$&" in a song's title is not read as a replacement pattern
const putTag = (html: string, existing: RegExp, tag: string) =>
  existing.test(html)
    ? html.replace(existing, () => tag)
    : html.replace('</head>', () => `  ${tag}\n  </head>`)

const removeTag = (html: string, existing: RegExp) => html.replace(existing, '')

const CANONICAL_TAG = /<link\s+rel="canonical"[^>]*>/u

export const writeHead = (html: string, head: PageHead | null) => {
  if (head === null) {
    return putTag(
      removeTag(html, CANONICAL_TAG),
      metaTag('name', 'robots'),
      '<meta name="robots" content="noindex" />'
    )
  }
  let page = putTag(
    html,
    CANONICAL_TAG,
    `<link rel="canonical" href="${escapeHtml(head.canonical)}" />`
  )
  const meta = (attribute: 'name' | 'property', key: string, value: string) => {
    page = putTag(
      page,
      metaTag(attribute, key),
      `<meta ${attribute}="${key}" content="${escapeHtml(value)}" />`
    )
  }
  meta('property', 'og:url', head.shareUrl ?? head.canonical)
  if (head.title !== undefined) {
    page = putTag(
      page,
      /<title>[^<]*<\/title>/u,
      `<title>${escapeHtml(head.title)}</title>`
    )
    meta('property', 'og:title', head.title)
  }
  if (head.description !== undefined) {
    meta('name', 'description', head.description)
    meta('property', 'og:description', head.description)
  }
  if (head.image !== undefined) {
    meta('property', 'og:image', head.image)
    meta('name', 'twitter:card', 'summary_large_image')
  }
  return page
}

const lookUpSong = async (request: Request, videoId: string) => {
  try {
    // The site's own proxy holds the API key, and its CDN cache answers repeat visits for free
    const response = await fetch(
      new URL(`/api/youtube/video/${videoId}`, request.url),
      { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) }
    )
    if (!response.ok) {
      return null
    }
    const body: unknown = await response.json()
    return previewFromVideo(body)
  } catch {
    return null
  }
}

const headFor = async (request: Request): Promise<PageHead | null> => {
  const url = new URL(request.url)
  const videoId = VIDEO_PATH.exec(url.pathname)?.groups?.videoId
  if (videoId !== undefined) {
    // A shared link keeps its lyrics style, since some apps open og:url rather than the link that was sent
    const style = url.searchParams.get('style')
    const canonical = new URL(`/v/${videoId}`, url.origin).href
    const shareUrl =
      style === null
        ? canonical
        : `${canonical}?style=${encodeURIComponent(style)}`
    return songHead(canonical, shareUrl, await lookUpSong(request, videoId))
  }
  const name = NAMED_PAGES[url.pathname]
  if (name !== undefined) {
    return {
      canonical: new URL(url.pathname, url.origin).href,
      title: `${name} · Synbox`,
    }
  }
  return null
}

export default async function pageHead(
  request: Request,
  context: { next: () => Promise<Response> }
) {
  if (new URL(request.url).pathname === '/') {
    return withSecurityHeaders(await context.next())
  }
  const [page, head] = await Promise.all([context.next(), headFor(request)])
  const isHtml = page.headers.get('content-type')?.includes('text/html')
  if (page.status !== 200 || isHtml !== true) {
    return withSecurityHeaders(page)
  }
  const headers = new Headers(page.headers)
  headers.delete('content-length')
  return withSecurityHeaders(
    new Response(writeHead(await page.text(), head), {
      headers,
      status: page.status,
    })
  )
}

// Pages only: a file (a path with a dot: sw.js, the manifest, icons, robots.txt, sitemap.xml) keeps the headers
// netlify.toml gives it, which an Edge Function's answer would lose
export const config = {
  excludedPath: ['/assets/*', '/api/*', '/*.*'],
  path: '/*',
}
