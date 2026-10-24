// The home gallery's song list. The lookup service that answers it scales to zero, and a cold start takes about
// a minute (2026-10-23 logs: 48 s to boot, then 503 for 13 s while it loads the library). So the last good list
// is kept, and the gallery gets it whenever the service can't answer in time; the request still wakes it.
// Shared by the Netlify function (deployed); dev and preview proxy straight to the service (vite.config.ts).

import { z } from 'zod'

export const LOOKUP_SONGS =
  'https://synbox-lookup-1045990822048.asia-southeast1.run.app/library/songs'

// A warm service answers in about a second from Netlify's function region
const WAIT_MS = 2500

export interface KeptList {
  get: () => Promise<string | null>
  set: (body: string) => Promise<void>
}

const songList = z.object({
  songs: z.array(z.object({ karaoke: z.boolean(), video_id: z.string() })).min(1),
})

// Durable: one copy for every edge node, so a visit reaches this function only after it goes stale, and then
// gets the stale copy while it refreshes. A kept list goes stale sooner, to pick up the fresh one once awake
const listHeaders = (cdnSeconds: number) => ({
  'Cache-Control': 'public, max-age=60',
  'Content-Type': 'application/json',
  'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${cdnSeconds}, stale-while-revalidate=86400`,
})

const fetchList = async (): Promise<string | null> => {
  const response = await fetch(LOOKUP_SONGS).catch(() => null)
  if (response?.ok !== true) {
    return null
  }
  const body = await response.text().catch(() => '')
  const parsed = songList.safeParse(JSON.parse(body || 'null'))
  return parsed.success ? body : null
}

export const handleLibrarySongs = async (
  kept: KeptList,
  waitUntil: (work: Promise<unknown>) => void
): Promise<Response> => {
  const live = fetchList().catch(() => null)
  const fresh = await Promise.race([
    live,
    new Promise<undefined>((resolve) => {
      setTimeout(resolve, WAIT_MS)
    }),
  ])
  if (typeof fresh === 'string') {
    waitUntil(kept.set(fresh).catch(() => null))
    return new Response(fresh, { headers: listHeaders(300) })
  }
  // Still waking or down: keep the fresh list when it comes, and answer with the last one now
  waitUntil(live.then(async (body) => body !== null && (await kept.set(body))))
  const last = await kept.get().catch(() => null)
  if (last !== null) {
    return new Response(last, { headers: listHeaders(30) })
  }
  return Response.json(
    { error: 'The library is still loading' },
    { headers: { 'Cache-Control': 'no-store', 'Retry-After': '3' }, status: 503 }
  )
}
