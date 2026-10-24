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
  songs: z
    .array(z.object({ karaoke: z.boolean(), video_id: z.string() }))
    .min(1),
})

// Durable: one copy for every edge node, so a visit reaches this function only after it goes stale, and then
// gets the stale copy while it refreshes. A kept list goes stale sooner, to pick up the fresh one once awake
const listHeaders = (cdnSeconds: number) => ({
  'Cache-Control': 'public, max-age=60',
  'Content-Type': 'application/json',
  'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${cdnSeconds}, stale-while-revalidate=86400`,
})

const fetchList = async (): Promise<string | null> => {
  try {
    const response = await fetch(LOOKUP_SONGS)
    if (!response.ok) {
      return null
    }
    const body = await response.text()
    return songList.safeParse(JSON.parse(body)).success ? body : null
  } catch {
    return null
  }
}

const keep = async (kept: KeptList, list: Promise<string | null>) => {
  try {
    const body = await list
    if (body !== null) {
      await kept.set(body)
    }
  } catch {
    // A failed write leaves the last list kept
  }
}

// The CDN keys its copy on the whole address, query included, and the app sends none: a query would run this
// function, and wake the lookup service, on every request
export const handleLibrarySongs = async (
  request: Request,
  kept: KeptList,
  waitUntil: (work: Promise<unknown>) => void
): Promise<Response> => {
  if (new URL(request.url).search !== '') {
    return Response.json(
      { error: 'Unknown query parameter' },
      { headers: { 'Cache-Control': 'no-store' }, status: 400 }
    )
  }
  const live = fetchList()
  // Kept whenever it comes, also after a cold service answered too late for this request (which woke it)
  waitUntil(keep(kept, live))
  const fresh = await Promise.race([
    live,
    // oxlint-disable-next-line promise/avoid-new -- turns setTimeout into a promise
    new Promise<undefined>((resolve) => {
      setTimeout(resolve, WAIT_MS)
    }),
  ])
  if (typeof fresh === 'string') {
    return new Response(fresh, { headers: listHeaders(300) })
  }
  // Still waking or down: the last list now
  let last: string | null = null
  try {
    last = await kept.get()
  } catch {
    // No kept list to fall back on
  }
  if (last !== null) {
    return new Response(last, { headers: listHeaders(30) })
  }
  return Response.json(
    { error: 'The library is still loading' },
    {
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '3' },
      status: 503,
    }
  )
}
