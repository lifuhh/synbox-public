// The app's generation calls (src/lib/generation/stream.ts) on their way to the generating Cloud Run service.
// That service admits only callers holding a Google ID token for it, so nothing that skips this Worker can start
// its GPU instance. The Worker passes the call on as it came (body, the app's own Authorization) and streams
// the answer back as it arrives, adding the ID token in X-Serverless-Authorization, which Cloud Run checks
// instead of Authorization, and the caller's address, signed, for the backend's guest keys and rate limits
// (synbox-transcribe-whisper › services/client_address.py).
import { Hono } from 'hono'
import type { Context } from 'hono'

import { claimGuestSong, guestDeviceKey, guestSongSpent } from './guest-song'
import { expireStalled } from './quota'

export interface GenerationEnv {
  // The generating service's URL, also the ID token's audience
  GENERATION_URL?: string
  // Secret: the JSON key of the service account allowed to invoke that service, and nothing else
  GENERATION_INVOKER_KEY?: string
  INTERNAL_SECRET: string
  // Guests' free songs (guest-song.ts)
  DB: D1Database
}

// Exactly the routes the generating service serves (synbox-transcribe-whisper › app.py › SERVED)
const ENDPOINTS = new Set([
  'validate',
  'generation-check',
  'transcribev2',
  'translate-annotate',
])

// The app's own pages: synbox.io, and Netlify's site with its deploy previews (the backend's ALLOWED_ORIGINS).
// Anything else, browser or script, is turned away here, before the GPU is asked
const APP_ORIGIN =
  /^https:\/\/(?:(?:www\.)?synbox\.io|(?:[a-z0-9-]+--)?synbox\.netlify\.app)$/u

const FORWARDED = [
  'accept',
  'authorization',
  'baggage',
  'content-type',
  'sentry-trace',
  'user-agent',
]
const RETURNED = ['cache-control', 'content-type']
// The calls carry a video id and a few flags
const MAX_BODY = 16 * 1024
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
// A token lives an hour; a fresh one is fetched once less than this is left
const TOKEN_MARGIN_MS = 5 * 60_000

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCodePoint(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')

const encodeJson = (value: object) =>
  base64url(new TextEncoder().encode(JSON.stringify(value)))

const pemBytes = (pem: string) =>
  Uint8Array.from(
    atob(pem.replaceAll(/-----[^-]+-----|\s/gu, '')),
    (char) => char.codePointAt(0) ?? 0
  )

interface InvokerKey {
  clientEmail: string
  privateKey: string
  keyId: string
}

const NOT_A_KEY = 'GENERATION_INVOKER_KEY is not a service account key'

// JSON.parse's own error quotes the text, which is the key: it is never passed on
const readJson = (json: string): unknown => {
  try {
    return JSON.parse(json)
  } catch {
    throw new Error(NOT_A_KEY)
  }
}

const parseKey = (json: string): InvokerKey => {
  const key = readJson(json)
  if (
    typeof key !== 'object' ||
    key === null ||
    !('client_email' in key) ||
    !('private_key' in key) ||
    !('private_key_id' in key) ||
    typeof key.client_email !== 'string' ||
    typeof key.private_key !== 'string' ||
    typeof key.private_key_id !== 'string'
  ) {
    throw new Error(NOT_A_KEY)
  }
  return {
    clientEmail: key.client_email,
    keyId: key.private_key_id,
    privateKey: key.private_key,
  }
}

// The account's own signed request for an ID token (Google's JWT bearer grant with a target_audience)
const assertion = async (key: InvokerKey, audience: string, now: number) => {
  const iat = Math.floor(now / 1000)
  const unsigned = `${encodeJson({ alg: 'RS256', kid: key.keyId, typ: 'JWT' })}.${encodeJson(
    {
      aud: TOKEN_URL,
      exp: iat + 3600,
      iat,
      iss: key.clientEmail,
      sub: key.clientEmail,
      target_audience: audience,
    }
  )}`
  const signer = await crypto.subtle.importKey(
    'pkcs8',
    pemBytes(key.privateKey),
    { hash: 'SHA-256', name: 'RSASSA-PKCS1-v1_5' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    signer,
    new TextEncoder().encode(unsigned)
  )
  return `${unsigned}.${base64url(new Uint8Array(signature))}`
}

const expiryOf = (token: string) => {
  const payload: unknown = JSON.parse(
    atob((token.split('.')[1] ?? '').replaceAll('-', '+').replaceAll('_', '/'))
  )
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('exp' in payload) ||
    typeof payload.exp !== 'number'
  ) {
    throw new Error('The ID token has no expiry')
  }
  return payload.exp * 1000
}

const mint = async (keyJson: string, audience: string) => {
  const key = parseKey(keyJson)
  const response = await fetch(TOKEN_URL, {
    body: new URLSearchParams({
      assertion: await assertion(key, audience, Date.now()),
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    }),
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(`Google's token endpoint answered ${response.status}`)
  }
  const body: unknown = await response.json()
  if (
    typeof body !== 'object' ||
    body === null ||
    !('id_token' in body) ||
    typeof body.id_token !== 'string'
  ) {
    throw new Error("Google's token endpoint sent no ID token")
  }
  return { expiresAt: expiryOf(body.id_token), token: body.id_token }
}

// One token per isolate, shared by its requests until near expiry; concurrent requests wait on the same fetch
let cached: {
  audience: string
  minted: Promise<{ token: string; expiresAt: number }>
} | null = null

const idToken = async (keyJson: string, audience: string) => {
  if (cached?.audience === audience) {
    try {
      const { token, expiresAt } = await cached.minted
      if (expiresAt - Date.now() > TOKEN_MARGIN_MS) {
        return token
      }
    } catch {
      // That fetch failed: fetch again
    }
  }
  const minted = mint(keyJson, audience)
  cached = { audience, minted }
  try {
    const { token } = await minted
    return token
  } catch (error) {
    if (cached?.minted === minted) {
      cached = null
    }
    throw error
  }
}

// Hex HMAC-SHA256 of the address under the internal secret (services/client_address.py › signature)
const signAddress = async (secret: string, address: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(address)
  )
  return [...new Uint8Array(mac)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const appOrigin = (c: Context) => {
  const origin = c.req.header('origin') ?? ''
  return APP_ORIGIN.test(origin) ? origin : null
}

const corsHeaders = (origin: string) => ({
  'Access-Control-Allow-Origin': origin,
  Vary: 'Origin',
})

export const generation = new Hono<{ Bindings: GenerationEnv }>()

// Where the app asks whether this device's free song is still there, so Generate Lyrics can say so
const GUEST_SONG = 'guest-song'

// The backend's own refusal shapes (app.py › generation_check; a stream's error line), so the app reads it the same
const SONG_USED = {
  code: 'guest_song_used',
  message: 'That’s your free song. Sign in for 5 a day',
}

const guestKeyOf = async (c: Context<{ Bindings: GenerationEnv }>) =>
  await guestDeviceKey(
    c.env.INTERNAL_SECRET,
    c.req.header('cf-connecting-ip') ?? '',
    c.req.header('x-synbox-device')
  )

const fieldsOf = (body: ArrayBuffer): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body))
    return typeof parsed === 'object' && parsed !== null
      ? Object.fromEntries(Object.entries(parsed))
      : {}
  } catch {
    return {}
  }
}

// A guest (a call without the app's Authorization) gets one song, ever, per device (guest-song.ts): asking is
// answered from the claim, and each step of a song must hold it. A token the backend can't verify makes it a guest
// there too, and its ledger then finds no claim. False when the song is spent
const guestMay = async (
  c: Context<{ Bindings: GenerationEnv }>,
  endpoint: string,
  body: ArrayBuffer
) => {
  if (c.req.header('authorization') !== undefined) {
    return true
  }
  const deviceKey = await guestKeyOf(c)
  const now = new Date()
  await expireStalled(c.env.DB, now)
  if (endpoint === 'generation-check') {
    return !(await guestSongSpent(c.env.DB, deviceKey, now.getTime()))
  }
  const { request_id: requestId, id: videoId } = fieldsOf(body)
  return (
    typeof requestId === 'string' &&
    requestId !== '' &&
    typeof videoId === 'string' &&
    (await claimGuestSong(
      c.env.DB,
      { deviceKey, requestId, videoId },
      now.getTime()
    ))
  )
}

const songUsed = (endpoint: string, cors: Record<string, string>) =>
  endpoint === 'generation-check'
    ? Response.json({ ...SONG_USED, ok: false }, { headers: cors })
    : new Response(
        `${JSON.stringify({ code: SONG_USED.code, data: SONG_USED.message, type: 'error' })}\n`,
        { headers: { ...cors, 'Content-Type': 'application/x-ndjson' } }
      )

generation.options('/:endpoint', (c) => {
  const origin = appOrigin(c)
  const endpoint = c.req.param('endpoint')
  if (
    !(ENDPOINTS.has(endpoint) || endpoint === GUEST_SONG) ||
    origin === null
  ) {
    return c.body(null, 403)
  }
  return c.body(null, 204, {
    ...corsHeaders(origin),
    'Access-Control-Allow-Headers':
      c.req.header('access-control-request-headers') ?? '',
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Max-Age': '600',
  })
})

// Whether this device still has its free song: `{ used }`
generation.post(`/${GUEST_SONG}`, async (c) => {
  const origin = appOrigin(c)
  if (origin === null) {
    return c.json({ code: 'forbidden' }, 403)
  }
  const now = new Date()
  await expireStalled(c.env.DB, now)
  const used = await guestSongSpent(
    c.env.DB,
    await guestKeyOf(c),
    now.getTime()
  )
  return c.json({ used }, 200, corsHeaders(origin))
})

generation.post('/:endpoint', async (c) => {
  const endpoint = c.req.param('endpoint')
  const origin = appOrigin(c)
  if (origin === null) {
    return c.json({ code: 'forbidden' }, 403)
  }
  const cors = corsHeaders(origin)
  if (!ENDPOINTS.has(endpoint)) {
    return c.json({ code: 'not_found' }, 404, cors)
  }
  const { GENERATION_URL: url, GENERATION_INVOKER_KEY: key } = c.env
  if (url === undefined || url === '' || key === undefined || key === '') {
    return c.json({ code: 'generation_unavailable' }, 503, cors)
  }
  if (Number(c.req.header('content-length') ?? 0) > MAX_BODY) {
    return c.json({ code: 'too_large' }, 413, cors)
  }
  const body = await c.req.arrayBuffer()
  if (body.byteLength > MAX_BODY) {
    return c.json({ code: 'too_large' }, 413, cors)
  }
  if (!(await guestMay(c, endpoint, body))) {
    return songUsed(endpoint, cors)
  }

  let token: string
  try {
    token = await idToken(key, url)
  } catch (error) {
    console.error(
      'No ID token for the generating service:',
      error instanceof Error ? error.message : 'unknown error'
    )
    return c.json({ code: 'generation_unavailable' }, 503, cors)
  }
  const headers = new Headers()
  for (const name of FORWARDED) {
    const value = c.req.header(name)
    if (value !== undefined) {
      headers.set(name, value)
    }
  }
  headers.set('X-Serverless-Authorization', `Bearer ${token}`)
  const address = c.req.header('cf-connecting-ip')
  if (address !== undefined && c.env.INTERNAL_SECRET !== '') {
    headers.set('X-Synbox-Client', address)
    headers.set(
      'X-Synbox-Client-Sig',
      await signAddress(c.env.INTERNAL_SECRET, address)
    )
  }

  let upstream: Response
  try {
    upstream = await fetch(`${url}/${endpoint}`, {
      body,
      headers,
      method: 'POST',
    })
  } catch {
    return c.json({ code: 'generation_unreachable' }, 502, cors)
  }
  const returned = new Headers(cors)
  for (const name of RETURNED) {
    const value = upstream.headers.get(name)
    if (value !== null) {
      returned.set(name, value)
    }
  }
  // The body as it arrives: the backend's progress messages reach the page one by one
  return new Response(upstream.body, {
    headers: returned,
    status: upstream.status,
  })
})
