// Whether a video is a song in Synbox's library: its lyrics row exists in Appwrite, the backend's own test
// (synbox-transcribe-whisper › services/discovery/library.py). Listens and likes are kept only for library songs,
// so a YouTube id pasted into a /v/ link adds nothing

export interface LibraryEnv {
  APPWRITE_URL?: string
  // The same values as the app's VITE_APPWRITE_PROJECT_ID, _DATABASE_ID and _LYRICS_COLLECTION_ID
  APPWRITE_PROJECT_ID?: string
  APPWRITE_DATABASE_ID?: string
  APPWRITE_LYRICS_TABLE_ID?: string
  // A server key with read access to the lyrics table; the Worker reads it with this key
  APPWRITE_API_KEY?: string
}

// `unknown`: Appwrite didn't answer, or the Worker has no Appwrite settings. Callers refuse the write
export type Membership = 'in' | 'out' | 'unknown'

// A song's row under the current id encoding and under the one used before the 2026-10 migration
// (src/utils › createAppwriteIdFromYoutubeId, legacyAppwriteIdFromYoutubeId); the backend reads both
const ENCODED_START: Record<string, string> = { '-': 'yt_h', _: 'yt_u' }
export const lyricsRowIds = (videoId: string) => {
  const start = ENCODED_START[videoId.charAt(0)]
  const current = start === undefined ? videoId : `${start}${videoId.slice(1)}`
  const legacy =
    /^[a-zA-Z0-9_]{1,36}$/u.test(videoId) && !videoId.startsWith('_')
      ? videoId
      : `yt_${videoId.split('-').join('_')}`
  return [...new Set([current, legacy])]
}

// A library song stays one for a day; a miss is asked again after a minute, so a song that just finished
// generating starts counting soon
const IN_SECONDS = 86_400
const OUT_SECONDS = 60
const cacheKey = (videoId: string) =>
  new Request(`https://api.synbox.io/__library/${videoId}`)

const askAppwrite = async (
  env: LibraryEnv,
  videoId: string,
  fetcher: typeof fetch
): Promise<Membership> => {
  const {
    APPWRITE_URL: url = 'https://cloud.appwrite.io/v1',
    APPWRITE_PROJECT_ID: project,
    APPWRITE_DATABASE_ID: database,
    APPWRITE_LYRICS_TABLE_ID: table,
  } = env
  if (
    project === undefined ||
    project === '' ||
    database === undefined ||
    database === '' ||
    table === undefined ||
    table === ''
  ) {
    console.error('library check: Appwrite settings missing')
    return 'unknown'
  }
  const queries = [
    { attribute: '$id', method: 'equal', values: lyricsRowIds(videoId) },
    { method: 'select', values: ['$id'] },
  ]
    .map((query) => `queries[]=${encodeURIComponent(JSON.stringify(query))}`)
    .join('&')
  try {
    const headers: Record<string, string> = { 'X-Appwrite-Project': project }
    if (env.APPWRITE_API_KEY !== undefined && env.APPWRITE_API_KEY !== '') {
      headers['X-Appwrite-Key'] = env.APPWRITE_API_KEY
    }
    const response = await fetcher(
      `${url}/tablesdb/${database}/tables/${table}/rows?${queries}&total=false`,
      { headers }
    )
    if (!response.ok) {
      console.error(`library check: Appwrite answered ${response.status}`)
      return 'unknown'
    }
    const body: { rows?: unknown[] } = await response.json()
    return Array.isArray(body.rows) && body.rows.length > 0 ? 'in' : 'out'
  } catch (error) {
    console.error('library check: Appwrite unreachable', error)
    return 'unknown'
  }
}

export const libraryMembership = async (
  env: LibraryEnv,
  videoId: string,
  fetcher: typeof fetch = fetch,
  // The colo's cache on Cloudflare; none in tests
  cache: Cache | undefined = 'caches' in globalThis ? caches.default : undefined
): Promise<Membership> => {
  const cached = await cache?.match(cacheKey(videoId))
  if (cached !== undefined) {
    return (await cached.text()) === 'in' ? 'in' : 'out'
  }
  const membership = await askAppwrite(env, videoId, fetcher)
  if (membership !== 'unknown') {
    await cache?.put(
      cacheKey(videoId),
      new Response(membership, {
        headers: {
          'Cache-Control': `max-age=${membership === 'in' ? IN_SECONDS : OUT_SECONDS}`,
        },
      })
    )
  }
  return membership
}
