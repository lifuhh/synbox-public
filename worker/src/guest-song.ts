// A guest's one free song, ever (the owner, 2026-10-27). A guest is known by a keyed hash of their network (IPv4, or
// IPv6's /64) and a few traits of the device that every browser on it reports alike: its system, its screen in
// device pixels, its pixel ratio, its cores (8 at most, as Safari caps them) and its time zone. A private window or a
// second browser on the same device is the same guest; another device is another. Only the hash is kept.
//
// The generation proxy (generation.ts) claims the song when a guest's generation call arrives and refuses a
// second; the ledger (quota.ts) reserves a guest's song only under a claim. Spent means its generation is
// running or worked, or, before the backend has reserved it, that the claim is younger than CLAIM_HOLD_MS: a song
// whose generation failed, or never started, is free again.
import { isTimeZone } from './quota'

// How long a claim holds before its generation is reserved: song checks (/validate) run first, a minute or two. A
// check that failed (a video that won't play) leaves no generation, and the song is free again after this
export const CLAIM_HOLD_MS = 5 * 60_000

const OS = new Set(['ios', 'android', 'macos', 'windows', 'linux', 'chromeos'])

const integer = (value: string | undefined, min: number, max: number) => {
  const n = Number(value)
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

const screenOf = (value: string | undefined) => {
  const match = /^(?<a>\d{2,5})x(?<b>\d{2,5})$/u.exec(value ?? '')
  if (match === null) {
    return '?'
  }
  // Short side first, so turning the device doesn't make it another one
  const [a, b] = [Number(match.groups?.a), Number(match.groups?.b)].toSorted(
    (x, y) => x - y
  )
  return `${a}x${b}`
}

// The X-Synbox-Device header (`os=ios; screen=1170x2532; dpr=3; cores=6; tz=Asia/Singapore`), canonical: a trait
// missing or malformed reads as '?', so a script that sends none is one guest per network
export const deviceTraits = (header: string | undefined) => {
  const fields = new Map(
    (header ?? '').split(';').map((pair) => {
      const [name = '', value = ''] = pair.split('=')
      return [name.trim(), value.trim()] as const
    })
  )
  const os = fields.get('os') ?? ''
  const cores = integer(fields.get('cores'), 1, 1024)
  const tz = fields.get('tz')
  return [
    OS.has(os) ? os : '?',
    screenOf(fields.get('screen')),
    integer(fields.get('dpr'), 1, 8) ?? '?',
    cores === null ? '?' : Math.min(cores, 8),
    isTimeZone(tz) ? tz : '?',
  ].join('|')
}

// IPv4 as it is; IPv6 by its /64, which one home or phone is given whole
export const networkOf = (address: string) => {
  if (!address.includes(':')) {
    return address
  }
  const [head = '', tail = ''] = address.split('::')
  const front = head === '' ? [] : head.split(':')
  const back = tail === '' ? [] : tail.split(':')
  const groups = address.includes('::')
    ? [
        ...front,
        ...Array.from({ length: 8 - front.length - back.length }, () => '0'),
        ...back,
      ]
    : front
  return `${groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group || '0', 16).toString(16))
    .join(':')}::/64`
}

export const guestDeviceKey = async (
  secret: string,
  address: string,
  header: string | undefined
) => {
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
    new TextEncoder().encode(
      `guest-song|${networkOf(address)}|${deviceTraits(header)}`
    )
  )
  return [...new Uint8Array(mac).slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

// Whether the claim on row `s` still holds. `since` is the parameter holding the oldest a claim without a generation
// may be and still hold
const spent = (
  since: string
) => `(exists (select 1 from "generation" g where g."id" = s."requestId" and g."status" <> 'failed')
  or (not exists (select 1 from "generation" g where g."id" = s."requestId") and s."updatedAt" > ${since}))`

export const guestSongSpent = async (
  db: D1Database,
  deviceKey: string,
  now: number
) =>
  (await db
    .prepare(
      `select 1 as "spent" from "guestSong" s where s."deviceKey" = ?1 and ${spent('?2')}`
    )
    .bind(deviceKey, now - CLAIM_HOLD_MS)
    .first<number>('spent')) === 1

// Takes the device's free song for generation `requestId`, or finds it already taken by that same generation (a
// reconnect, or its next step). False when another generation holds it
export const claimGuestSong = async (
  db: D1Database,
  claim: { deviceKey: string; requestId: string; videoId: string },
  now: number
) => {
  await db
    .prepare(
      `insert into "guestSong" as s ("deviceKey", "requestId", "videoId", "createdAt", "updatedAt")
       values (?1, ?2, ?3, ?4, ?4)
       on conflict ("deviceKey") do update set "requestId" = ?2, "videoId" = ?3, "updatedAt" = ?4
       where s."requestId" <> ?2 and not ${spent('?5')}`
    )
    .bind(
      claim.deviceKey,
      claim.requestId,
      claim.videoId,
      now,
      now - CLAIM_HOLD_MS
    )
    .run()
  const holder = await db
    .prepare(`select "requestId" from "guestSong" where "deviceKey" = ?1`)
    .bind(claim.deviceKey)
    .first<string>('requestId')
  return holder === claim.requestId
}
