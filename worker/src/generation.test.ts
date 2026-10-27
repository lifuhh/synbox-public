import { afterEach, beforeAll, expect, test } from 'bun:test'

import worker from './index'
import { migratedD1 } from './test-d1'

// The Worker as Cloudflare runs it, with Google's token endpoint and the generating service faked behind fetch
const SERVICE = 'https://generating.example.run.app'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const ORIGIN = 'https://synbox.io'
const SECRET = 'internal'

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCodePoint(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
const fromBase64url = (text: string) =>
  Uint8Array.from(
    atob(text.replaceAll('-', '+').replaceAll('_', '/')),
    (char) => char.codePointAt(0) ?? 0
  )

let keyJson = ''
let publicKey: CryptoKey

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      hash: 'SHA-256',
      modulusLength: 2048,
      name: 'RSASSA-PKCS1-v1_5',
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ['sign', 'verify']
  )
  if (!('publicKey' in pair)) {
    throw new Error('Expected a key pair')
  }
  ;({ publicKey } = pair)
  const exported = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  if (!(exported instanceof ArrayBuffer)) {
    throw new TypeError('Expected PKCS #8 bytes')
  }
  const pkcs8 = new Uint8Array(exported)
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCodePoint(...pkcs8))}\n-----END PRIVATE KEY-----\n`
  keyJson = JSON.stringify({
    client_email: 'invoker@example.iam.gserviceaccount.com',
    private_key: pem,
    private_key_id: 'kid-1',
    type: 'service_account',
  })
})

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

interface Seen {
  tokenCalls: number
  upstream: Request[]
}

// Google's token endpoint checks the account's signed assertion and answers with an ID token for its
// target_audience; the generating service answers with `respond`
const fake = (respond: (request: Request) => Response) => {
  const seen: Seen = { tokenCalls: 0, upstream: [] }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fake answers only the two hosts the route calls
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    if (request.url === TOKEN_URL) {
      seen.tokenCalls += 1
      const form = new URLSearchParams(await request.text())
      const [header, claims, signature] = (form.get('assertion') ?? '').split(
        '.'
      )
      const valid = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        publicKey,
        fromBase64url(signature ?? ''),
        new TextEncoder().encode(`${header}.${claims}`)
      )
      const parsed: unknown = JSON.parse(
        new TextDecoder().decode(fromBase64url(claims ?? ''))
      )
      const audience =
        typeof parsed === 'object' &&
        parsed !== null &&
        'target_audience' in parsed
          ? parsed.target_audience
          : null
      if (!valid || typeof audience !== 'string') {
        return Response.json({ error: 'invalid_grant' }, { status: 400 })
      }
      const exp = Math.floor(Date.now() / 1000) + 3600
      const payload = base64url(
        new TextEncoder().encode(JSON.stringify({ aud: audience, exp }))
      )
      return Response.json({
        id_token: `h.${payload}.s${seen.tokenCalls}`,
      })
    }
    seen.upstream.push(request)
    return respond(request)
  }) as typeof fetch
  return seen
}

const env = (db: D1Database = migratedD1().db) => ({
  DB: db,
  GENERATION_INVOKER_KEY: keyJson,
  GENERATION_URL: SERVICE,
  INTERNAL_SECRET: SECRET,
})

const call = async (
  path: string,
  init: RequestInit,
  bindings: Record<string, unknown> = env()
) =>
  await worker.fetch(
    new Request(`https://api.synbox.io${path}`, init),
    bindings,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route never schedules work
    {} as ExecutionContext
  )

const post = async (
  endpoint: string,
  headers: Record<string, string> = {},
  body = '{"id":"abcdefghijk","kind":"new"}'
) =>
  await call(`/api/generation/${endpoint}`, {
    body,
    headers: {
      'CF-Connecting-IP': '203.0.113.7',
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      ...headers,
    },
    method: 'POST',
  })

const hmacHex = async (secret: string, text: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign']
  )
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))
  )
  return [...mac].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

test('a call is passed on as it came, with an ID token for the service and the signed caller address', async () => {
  const seen = fake(() =>
    Response.json(
      { code: 'guest_limit', message: 'x', ok: false },
      { headers: { 'Set-Cookie': 'a=b' } }
    )
  )

  const response = await post('generation-check', {
    Authorization: 'Bearer app-jwt',
    Cookie: 'better-auth.session_token=s',
  })

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    code: 'guest_limit',
    message: 'x',
    ok: false,
  })
  expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN)
  expect(response.headers.get('set-cookie')).toBeNull()
  const [sent] = seen.upstream
  expect(sent?.url).toBe(`${SERVICE}/generation-check`)
  expect(await sent?.text()).toBe('{"id":"abcdefghijk","kind":"new"}')
  expect(sent?.headers.get('authorization')).toBe('Bearer app-jwt')
  expect(sent?.headers.get('x-serverless-authorization')).toMatch(
    /^Bearer h\.[^.]+\.s1$/u
  )
  const token = sent?.headers.get('x-serverless-authorization') ?? ''
  expect(
    JSON.parse(
      new TextDecoder().decode(fromBase64url(token.split('.')[1] ?? ''))
    )
  ).toMatchObject({ aud: SERVICE })
  expect(sent?.headers.get('x-synbox-client')).toBe('203.0.113.7')
  expect(sent?.headers.get('x-synbox-client-sig')).toBe(
    await hmacHex(SECRET, '203.0.113.7')
  )
  expect(sent?.headers.get('cookie')).toBeNull()
  expect(sent?.headers.get('origin')).toBeNull()
})

const text = (chunk: unknown) =>
  chunk instanceof Uint8Array ? new TextDecoder().decode(chunk) : ''

test('the stream reaches the page message by message, not when it ends', async () => {
  let release: (() => void) | undefined
  // oxlint-disable-next-line promise/avoid-new -- held until the test has read the first message
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  fake(
    () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(
              new TextEncoder().encode('{"type":"update","data":"first"}\n')
            )
            await held
            controller.enqueue(
              new TextEncoder().encode('{"type":"update","data":"second"}\n')
            )
            controller.close()
          },
        }),
        { headers: { 'Content-Type': 'application/x-ndjson' } }
      )
  )

  const response = await post('validate', { Authorization: 'Bearer app-jwt' })
  const reader = response.body?.getReader()
  const first = await reader?.read()
  // The upstream has not sent its second message yet: the first arrived on its own
  expect(text(first?.value)).toBe('{"type":"update","data":"first"}\n')
  release?.()
  const second = await reader?.read()
  expect(text(second?.value)).toBe('{"type":"update","data":"second"}\n')
  expect(response.headers.get('content-type')).toBe('application/x-ndjson')
})

test('one ID token serves the calls that follow until near its expiry', async () => {
  const seen = fake(() => Response.json({ ok: true }))

  await post('generation-check', {}, '{"id":"abcdefghijk","kind":"regenerate"}')
  await post('generation-check', {}, '{"id":"bcdefghijkl","kind":"regenerate"}')

  const [first, second] = seen.upstream.map((request) =>
    request.headers.get('x-serverless-authorization')
  )
  expect(seen.upstream).toHaveLength(2)
  expect(second).toBe(first)
  expect(seen.tokenCalls).toBeLessThanOrEqual(1)
})

test('calls that are not the app generating never reach the service', async () => {
  const seen = fake(() => Response.json({ ok: true }))

  const refused = await Promise.all([
    post('generation-check', { Origin: 'https://example.com' }),
    post('generation-check', { Origin: '' }),
    post('generation-check', { Origin: 'https://synbox.io.example.com' }),
    post('lyrics/abcdefghijk/versions'),
    post('cors-test'),
    post('generation-check', {}, 'x'.repeat(17 * 1024)),
    call('/api/generation/validate', {
      headers: { Origin: ORIGIN },
      method: 'GET',
    }),
  ])

  expect(refused.map((response) => response.status)).toEqual([
    403, 403, 403, 404, 404, 413, 404,
  ])
  expect(seen.upstream).toHaveLength(0)
})

test('without the invoker key generation says it is unavailable', async () => {
  const seen = fake(() => Response.json({ ok: true }))

  const response = await call(
    '/api/generation/validate',
    {
      body: '{}',
      headers: { Origin: ORIGIN },
      method: 'POST',
    },
    { GENERATION_URL: SERVICE, INTERNAL_SECRET: SECRET }
  )

  expect(response.status).toBe(503)
  expect(seen.upstream).toHaveLength(0)
})

const preflight = async (origin: string, endpoint = 'transcribev2') =>
  await call(`/api/generation/${endpoint}`, {
    headers: {
      'Access-Control-Request-Headers':
        'authorization,content-type,sentry-trace,baggage',
      'Access-Control-Request-Method': 'POST',
      Origin: origin,
    },
    method: 'OPTIONS',
  })

test("a preflight from the app's pages is answered here, others are refused", async () => {
  const seen = fake(() => Response.json({ ok: true }))
  const allowed = await preflight(
    'https://deploy-preview-339--synbox.netlify.app'
  )

  expect(allowed.status).toBe(204)
  expect(allowed.headers.get('access-control-allow-origin')).toBe(
    'https://deploy-preview-339--synbox.netlify.app'
  )
  expect(allowed.headers.get('access-control-allow-headers')).toBe(
    'authorization,content-type,sentry-trace,baggage'
  )
  const otherSite = await preflight('https://evil.netlify.app')
  const otherPath = await preflight(ORIGIN, 'nothing')
  expect(otherSite.status).toBe(403)
  expect(otherPath.status).toBe(403)
  expect(seen.upstream).toHaveLength(0)
})

// A guest's free song, through the proxy as the app calls it: no Authorization, the device's traits in a header
const PHONE = 'os=ios; screen=1170x2532; dpr=3; cores=6; tz=Asia/Singapore'
const guestCall = async (
  db: D1Database,
  endpoint: string,
  { device = PHONE, ip = '203.0.113.7', requestId = 'r1', cookie = '' } = {}
) =>
  await call(
    `/api/generation/${endpoint}`,
    {
      body: JSON.stringify({
        id: 'abcdefghijk',
        kind: 'new',
        request_id: requestId,
      }),
      headers: {
        'CF-Connecting-IP': ip,
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        'X-Synbox-Device': device,
        ...(cookie === '' ? {} : { Cookie: cookie }),
      },
      method: 'POST',
    },
    env(db)
  )

const streams = () =>
  fake(
    () =>
      new Response('{"type":"update","data":"x"}\n', {
        headers: { 'Content-Type': 'application/x-ndjson' },
      })
  )

const used = async (db: D1Database) => {
  const response = await guestCall(db, 'guest-song')
  const body: unknown = await response.json()
  return typeof body === 'object' && body !== null && 'used' in body
    ? body.used
    : null
}

test('a private window or another browser on the same device gets no second free song; another device does', async () => {
  const seen = streams()
  const { db } = migratedD1()

  expect(await used(db)).toBe(false)
  const first = await guestCall(db, 'validate', { cookie: 'synboxBrowser=a' })
  expect(await first.text()).toBe('{"type":"update","data":"x"}\n')
  // The same song's next step holds the same claim
  await guestCall(db, 'transcribev2')
  expect(seen.upstream).toHaveLength(2)

  // A private window: no cookie, no storage, the phone turned; same network, same device
  const incognito = await guestCall(db, 'validate', {
    device: 'os=ios; screen=2532x1170; dpr=3; cores=6; tz=Asia/Singapore',
    requestId: 'r2',
  })
  expect(await incognito.text()).toBe(
    '{"code":"guest_song_used","data":"That’s your free song. Sign in for 5 a day","type":"error"}\n'
  )
  const checked = await guestCall(db, 'generation-check', { requestId: 'r2' })
  expect(await checked.json()).toEqual({
    code: 'guest_song_used',
    message: 'That’s your free song. Sign in for 5 a day',
    ok: false,
  })
  expect(await used(db)).toBe(true)

  // One home's IPv6 /64 is one network
  const home = await guestCall(db, 'validate', {
    ip: '2001:db8:1:2::1',
    requestId: 'r3',
  })
  const sameHome = await guestCall(db, 'validate', {
    ip: '2001:db8:1:2:aaaa::9',
    requestId: 'r4',
  })
  expect(await home.text()).toContain('"update"')
  expect(await sameHome.text()).toContain('guest_song_used')

  // Another device on the first network: a laptop, then its other browser (Safari caps the cores Chrome reports)
  const laptop = await guestCall(db, 'validate', {
    device: 'os=macos; screen=2880x1800; dpr=2; cores=10; tz=Asia/Singapore',
    requestId: 'r5',
  })
  const laptopSafari = await guestCall(db, 'validate', {
    device: 'os=macos; screen=2880x1800; dpr=2; cores=8; tz=Asia/Singapore',
    requestId: 'r6',
  })
  expect(await laptop.text()).toContain('"update"')
  expect(await laptopSafari.text()).toContain('guest_song_used')
  expect(seen.upstream).toHaveLength(4)
})

test("a guest's song that failed, or never started, is free again", async () => {
  streams()
  const { db, sqlite } = migratedD1()
  await guestCall(db, 'validate')
  // The backend reserved it, then the song failed
  sqlite.run(
    `insert into "generation" ("id", "guestKey", "videoId", "kind", "status", "utcDay", "createdAt")
     values ('r1', 'net', 'abcdefghijk', 'new', 'failed', '2026-10-27', 0)`
  )
  expect(await used(db)).toBe(false)
  const again = await guestCall(db, 'validate', { requestId: 'r2' })
  expect(await again.text()).toContain('"update"')
  expect(await used(db)).toBe(true)
  // r2's check never reached a generation (a video that won't play): after a while the claim lets go
  sqlite.run(`update "guestSong" set "updatedAt" = 0`)
  expect(await used(db)).toBe(false)
})
