// The local dev and preview servers' stand-in for the auth Worker's lyrics routes (worker/src/lyrics.ts): the same
// paths and answers, without the hourly count or the translations' mark, read with the env file's Appwrite settings
// (plus APPWRITE_API_KEY when the env file has one) and the lookup service (plus LOOKUP_KEY)

const FIELDS = [
  'labelled_full_lyrics',
  'romaji',
  'eng_translation',
  'chi_translation',
  'plain_lyrics',
  'active_version',
]
const VIDEO_ID = /^[\w-]{11}$/u
const ENCODED_START: Record<string, string> = { '-': 'yt_h', _: 'yt_u' }

// worker/src/library-songs.ts › lyricsRowIds
const rowIds = (videoId: string) => {
  const start = ENCODED_START[videoId.charAt(0)]
  const current = start === undefined ? videoId : `${start}${videoId.slice(1)}`
  const legacy =
    /^[a-zA-Z0-9_]{1,36}$/u.test(videoId) && !videoId.startsWith('_')
      ? videoId
      : `yt_${videoId.split('-').join('_')}`
  return [...new Set([current, legacy])]
}

const rows = async (
  env: Record<string, string>,
  videoIds: string[],
  fields: string[]
): Promise<Record<string, unknown>[]> => {
  const ids = videoIds.flatMap(rowIds)
  const queries = [
    { attribute: '$id', method: 'equal', values: ids },
    {
      method: 'select',
      values: ['$id', '$createdAt', '$updatedAt', ...fields],
    },
    { method: 'limit', values: [ids.length] },
  ]
    .map((query) => `queries[]=${encodeURIComponent(JSON.stringify(query))}`)
    .join('&')
  const headers: Record<string, string> = {
    'X-Appwrite-Project': env.VITE_APPWRITE_PROJECT_ID ?? '',
  }
  if ((env.APPWRITE_API_KEY ?? '') !== '') {
    headers['X-Appwrite-Key'] = env.APPWRITE_API_KEY ?? ''
  }
  const url = env.VITE_APPWRITE_URL ?? 'https://cloud.appwrite.io/v1'
  const response = await fetch(
    `${url}/tablesdb/${env.VITE_APPWRITE_DATABASE_ID}/tables/${env.VITE_APPWRITE_LYRICS_COLLECTION_ID}/rows?${queries}&total=false`,
    { headers }
  )
  if (!response.ok) {
    throw new Error(`Appwrite answered ${response.status}`)
  }
  const body: unknown = await response.json()
  const found =
    typeof body === 'object' && body !== null && 'rows' in body
      ? body.rows
      : null
  return Array.isArray(found)
    ? found.filter(
        (row): row is Record<string, unknown> =>
          typeof row === 'object' && row !== null
      )
    : []
}

const rowOf = (videoId: string, found: Record<string, unknown>[]) => {
  const [current, legacy] = rowIds(videoId)
  return (
    found.find((row) => row.$id === current) ??
    found.find((row) => row.$id === legacy)
  )
}

const datesOf = (row: Record<string, unknown>) => ({
  createdAt:
    typeof row.$createdAt === 'string' ? Date.parse(row.$createdAt) : 0,
  updatedAt:
    typeof row.$updatedAt === 'string' ? Date.parse(row.$updatedAt) : 0,
})

const json = (status: number, body: unknown) => Response.json(body, { status })

const lyricsOf = async (env: Record<string, string>, videoId: string) => {
  if (!VIDEO_ID.test(videoId)) {
    return json(400, { code: 'bad_request' })
  }
  const row = rowOf(videoId, await rows(env, [videoId], FIELDS))
  if (row === undefined) {
    return json(404, { code: 'not_found' })
  }
  const body: Record<string, unknown> = { videoId, ...datesOf(row) }
  for (const field of FIELDS) {
    body[field] = row[field] ?? null
  }
  return json(200, body)
}

const datesFor = async (env: Record<string, string>, query: string) => {
  const ids = query.split(',').filter(Boolean)
  if (
    ids.length === 0 ||
    ids.length > 50 ||
    !ids.every((id) => VIDEO_ID.test(id))
  ) {
    return json(400, { code: 'bad_request' })
  }
  const found = await rows(env, ids, [])
  return json(200, {
    songs: ids.flatMap((videoId) => {
      const row = rowOf(videoId, found)
      return row === undefined ? [] : [{ videoId, ...datesOf(row) }]
    }),
  })
}

const karaokeOf = async (
  env: Record<string, string>,
  videoId: string,
  search: string
) => {
  const base = env.VITE_SYNBOX_LOOKUP_URL ?? env.VITE_SYNBOX_BE_URL ?? ''
  const headers: Record<string, string> = { Accept: 'application/json' }
  if ((env.LOOKUP_KEY ?? '') !== '') {
    headers['X-Synbox-Lookup-Key'] = env.LOOKUP_KEY ?? ''
  }
  const upstream = await fetch(
    `${base}/karaoke/${encodeURIComponent(videoId)}${search}`,
    { headers }
  )
  return new Response(await upstream.text(), {
    headers: { 'Content-Type': 'application/json' },
    status: upstream.status,
  })
}

export const handleLyrics = async (
  request: Request,
  env: Record<string, string>
): Promise<Response | null> => {
  const url = new URL(request.url)
  const lyrics = /^\/api\/lyrics\/(?<id>[^/]+)$/u.exec(url.pathname)?.groups?.id
  if (lyrics !== undefined) {
    return await lyricsOf(env, lyrics)
  }
  if (url.pathname === '/api/lyrics-dates') {
    return await datesFor(env, url.searchParams.get('ids') ?? '')
  }
  const karaoke = /^\/api\/karaoke\/(?<id>[^/]+)$/u.exec(url.pathname)?.groups
    ?.id
  return karaoke === undefined
    ? null
    : await karaokeOf(env, karaoke, url.search)
}
