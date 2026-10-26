// The pages search engines should know: home, About, Privacy, Terms, and a page per song in the library (the
// home gallery's list, from the CDN's copy of /api/library/songs). robots.txt points here. Without the list it
// still answers, with the fixed pages, and is kept only briefly so the next request tries again.

import { z } from 'zod'

const FIXED_PAGES = ['/', '/about', '/privacy', '/terms']
const VIDEO_ID = /^[\w-]{11}$/u

const songList = z.object({
  songs: z.array(z.object({ video_id: z.string() })),
})

const libraryIds = async (origin: string) => {
  try {
    const response = await fetch(new URL('/api/library/songs', origin))
    if (!response.ok) {
      return null
    }
    const parsed = songList.safeParse(await response.json())
    return parsed.success
      ? parsed.data.songs
          .map((song) => song.video_id)
          .filter((id) => VIDEO_ID.test(id))
      : null
  } catch {
    return null
  }
}

const sitemap = async (request: Request) => {
  const { origin } = new URL(request.url)
  const ids = await libraryIds(origin)
  const paths = [...FIXED_PAGES, ...(ids ?? []).map((id) => `/v/${id}`)]
  const urls = paths.map((path) => `  <url><loc>${origin}${path}</loc></url>`)
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`
  return new Response(body, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'application/xml; charset=utf-8',
      'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${ids === null ? 300 : 86_400}`,
    },
  })
}

export default sitemap

export const config = { path: '/sitemap.xml' }
