import { useQuery } from '@tanstack/react-query'
import { adminClient, jwtClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { useAtomValue } from 'jotai'
import { z } from 'zod'

import { toast } from '@/components/ui/use-toast'
import { guestSongSpentAtom } from '@/lib/account-prompts'
import { DEVICE_HEADER, deviceTraits } from '@/lib/device-traits'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'
import { BE_ADDRESS } from '@/lib/synbox-flask/address'

// Same origin: Netlify (and the dev server) pass /api/auth/* and /api/me to the auth Worker, so its
// session cookie is first-party on synbox.io
export const authClient = createAuthClient({
  plugins: [jwtClient(), adminClient()],
})

// The account's latest "can I add more songs a day" (worker/src/requests.ts); null when it never asked
const songRequestSchema = z.object({
  createdAt: z.number(),
  decidedAt: z.number().nullable(),
  granted: z.number().nullable(),
  status: z.enum(['open', 'approved', 'declined']),
})

const quotaSchema = z.object({
  // Songs a day; null = no cap (admins)
  limit: z.number().nullable(),
  // Missing from a Worker older than the request feature
  request: songRequestSchema.nullable().optional(),
  // The account's next local midnight
  resetsAt: z.string(),
  used: z.number(),
})

const meSchema = z.object({
  quota: quotaSchema.optional(),
  // The zone the account's day follows; null until the app reports one
  timeZone: z.string().nullable().optional(),
  user: z
    .object({
      email: z.string(),
      id: z.string(),
      image: z.string().nullable(),
      name: z.string(),
      role: z.string(),
    })
    .nullable(),
})

export type Quota = z.infer<typeof quotaSchema>
export type SongRequest = z.infer<typeof songRequestSchema>
export type Me = z.infer<typeof meSchema>

// The last answer from /api/me, for code outside React (start-generation.tsx asks whether this is a guest)
let knownMe: Me | null = null

// True only once /api/me answered that nobody is signed in
export const knownGuest = () => knownMe !== null && knownMe.user === null

export const knownQuota = () => knownMe?.quota ?? null

// Who was signed in when this browser last asked: their picture's URL ('' for none), or nothing for a guest.
// The top bar draws its account control from it before /api/me answers, about a second into a phone's load
const LAST_ACCOUNT_KEY = 'synboxLastAccount'

export const lastAccount = (): { image: string | null } | null => {
  try {
    const image = localStorage.getItem(LAST_ACCOUNT_KEY)
    return image === null ? null : { image: image === '' ? null : image }
  } catch {
    return null
  }
}

const rememberAccount = ({ user }: Me) => {
  try {
    if (user === null) {
      localStorage.removeItem(LAST_ACCOUNT_KEY)
    } else {
      localStorage.setItem(LAST_ACCOUNT_KEY, user.image ?? '')
    }
  } catch {
    // Storage blocked: the bar waits for the answer instead
  }
}

export const fetchMe = async (): Promise<Me> => {
  const response = await fetch('/api/me', { credentials: 'same-origin' })
  if (!response.ok) {
    throw new Error(`/api/me answered ${response.status}`)
  }
  const me = meSchema.parse(await response.json())
  rememberAccount(me)
  knownMe = me
  return me
}

const mySongsSchema = z.object({
  songs: z.array(z.object({ generatedAt: z.number(), videoId: z.string() })),
})

// The songs this account generated, newest first; empty for a guest
export const fetchMySongs = async () => {
  const response = await fetch('/api/me/songs', { credentials: 'same-origin' })
  if (!response.ok) {
    throw new Error(`/api/me/songs answered ${response.status}`)
  }
  return mySongsSchema.parse(await response.json()).songs
}

// One retry: until it answers, everyone looks like a guest and admin pages wait
export const useMe = () =>
  useQuery({
    queryFn: fetchMe,
    queryKey: [QUERY_KEYS.GET_ME],
    retry: 1,
    staleTime: 60_000,
  })

// Whether this device's one free song is spent (worker/src/guest-song.ts, asked of the generation proxy); null when
// unknown (no answer, or a local backend without the route), which counts as still there: the press finds out
const fetchGuestSongUsed = async () => {
  try {
    const response = await fetch(`${BE_ADDRESS}/guest-song`, {
      headers: { [DEVICE_HEADER]: deviceTraits() },
      method: 'POST',
    })
    const body: unknown = await response.json()
    return typeof body === 'object' &&
      body !== null &&
      'used' in body &&
      typeof body.used === 'boolean'
      ? body.used
      : null
  } catch {
    return null
  }
}

export const useGuestSongUsed = (guest: boolean) =>
  useQuery({
    enabled: guest,
    queryFn: fetchGuestSongUsed,
    queryKey: [QUERY_KEYS.GET_GUEST_SONG],
    staleTime: 5 * 60_000,
  }).data === true

// What the person on the page may do. Browsing is open to everyone; a guest adds one song, ever, and an account
// a few a day. `newSong` is false for a guest whose song is spent, and for an account that added today's songs.
// `ready` is false until the sign-in check answers; until then everyone looks like a guest
export type Access =
  | { kind: 'guest'; newSong: boolean; admin: false; ready: boolean }
  | {
      kind: 'user'
      newSong: boolean
      admin: boolean
      quota: Quota
      ready: true
    }

export const useAccess = (): Access => {
  const { data, isPending } = useMe()
  const user = data?.user ?? null
  const guest = !isPending && (user === null || data?.quota === undefined)
  const asked = useGuestSongUsed(guest)
  const spent = useAtomValue(guestSongSpentAtom) || asked
  if (user === null || data?.quota === undefined) {
    return { admin: false, kind: 'guest', newSong: !spent, ready: !isPending }
  }
  const { quota } = data
  return {
    admin: user.role === 'admin',
    kind: 'user',
    newSong: quota.limit === null || quota.used < quota.limit,
    quota,
    ready: true,
  }
}

// Refusals that signing in would fix: the app opens the sign-in sheet for them (account-prompts.ts)
export const SIGN_IN_CODES = new Set(['sign_in_required', 'guest_song_used'])

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

// When an account has added today's songs: what it did, and when more come. The day ends at the account's own
// midnight, so "midnight" is exact
export const songsDoneText = (quota: Quota) =>
  quota.limit === null || quota.limit === 0
    ? 'More at midnight'
    : `That’s ${plural(quota.limit, 'song', 'songs')} today. More at midnight`

// The quiet counter where songs are added (You page, account menu): "3 Songs Left Today", and once they're added,
// when more come rather than a zero
export const songsLeftText = (quota: Quota) => {
  if (quota.limit === null) {
    return 'Unlimited Songs'
  }
  const left = quota.limit - quota.used
  return left > 0
    ? `${plural(left, 'Song', 'Songs')} Left Today`
    : songsDoneText(quota)
}

// Where the account's latest request stands, for the You page; null when there's nothing to say
export const requestText = (request: SongRequest | null | undefined) => {
  if (request === null || request === undefined) {
    return null
  }
  if (request.status === 'open') {
    return 'Request sent. I’ll get back to you'
  }
  if (request.status === 'approved') {
    return request.granted === null
      ? null
      : `You now have ${plural(request.granted, 'song', 'songs')} a day`
  }
  return 'I couldn’t add more this time'
}

// Sends the browser's time zone when the account's day follows another one, so "midnight" is the listener's
export const syncTimeZone = async (me: Me) => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (me.user === null || zone === '' || me.timeZone === zone) {
    return false
  }
  const response = await fetch('/api/me/time-zone', {
    body: JSON.stringify({ timeZone: zone }),
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
  })
  return response.ok
}

// "Can I add more songs a day?" with a short note; false when one is already waiting
export const sendSongRequest = async (note: string) => {
  const response = await fetch('/api/me/quota-request', {
    body: JSON.stringify({ note }),
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  if (response.status === 409) {
    return false
  }
  if (!response.ok) {
    throw new Error(`/api/me/quota-request answered ${response.status}`)
  }
  return true
}

const signInFailed = () => {
  toast({
    description: 'Check your connection and try again',
    title: "Couldn't Sign In",
    variant: 'destructive',
  })
}

// On its way to Google the page leaves; a failure says so wherever Sign In was pressed. Null when it threw
export const signInWithGoogle = async () => {
  try {
    const result = await authClient.signIn.social({
      callbackURL: location.href,
      provider: 'google',
    })
    if (result.error !== null) {
      signInFailed()
    }
    return result
  } catch {
    signInFailed()
    return null
  }
}

// The JWT lasts 15 minutes; one is reused until a minute before it expires
let cachedToken: { token: string; expiresAt: number } | null = null

const expiryOf = (token: string) => {
  const payload: unknown = JSON.parse(
    atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))
  )
  return typeof payload === 'object' &&
    payload !== null &&
    'exp' in payload &&
    typeof payload.exp === 'number'
    ? payload.exp * 1000
    : 0
}

// A short-lived JWT for the lyrics backend, or null for a guest. Never holds up a generation for long:
// without a token the backend answers with a sign-in prompt instead
export const backendToken = async (): Promise<string | null> => {
  if (cachedToken !== null && cachedToken.expiresAt - Date.now() > 60_000) {
    return cachedToken.token
  }
  try {
    const { data } = await authClient.token({
      fetchOptions: { signal: AbortSignal.timeout(5000) },
    })
    cachedToken =
      data === null
        ? null
        : { expiresAt: expiryOf(data.token), token: data.token }
    return cachedToken?.token ?? null
  } catch {
    return null
  }
}

export const signOut = async () => {
  cachedToken = null
  await authClient.signOut()
}
