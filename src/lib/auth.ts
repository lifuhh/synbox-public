import { useQuery } from '@tanstack/react-query'
import { adminClient, jwtClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { useSyncExternalStore } from 'react'
import { z } from 'zod'

import { toast } from '@/components/ui/use-toast'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'

// Same origin: Netlify (and the dev server) pass /api/auth/* and /api/me to the auth Worker, so its
// session cookie is first-party on synbox.io
export const authClient = createAuthClient({
  plugins: [jwtClient(), adminClient()],
})

const quotaSchema = z.object({
  // null = no limit (admins)
  limit: z.number().nullable(),
  resetsAt: z.string(),
  used: z.number(),
})

// Invited: the account has its own daily limit (an admin allowed its request, or set one), so it never needs
// to ask; requested: it has asked
const inviteSchema = z.object({
  invited: z.boolean(),
  requested: z.boolean(),
})

const meSchema = z.object({
  invite: inviteSchema.optional(),
  quota: quotaSchema.optional(),
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
export type Invite = z.infer<typeof inviteSchema>
export type Me = z.infer<typeof meSchema>

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

// A guest gets one new song a day per network. The backend enforces it; this only remembers, in this browser,
// that today's is used, so the page offers sign-in instead of a song that would be refused
const GUEST_SONG_KEY = 'synbox-guest-song-day'
const guestListeners = new Set<() => void>()
const utcDay = () => new Date().toISOString().slice(0, 10)

const guestSongUsed = () => {
  try {
    return localStorage.getItem(GUEST_SONG_KEY) === utcDay()
  } catch {
    return false
  }
}

export const markGuestSongUsed = () => {
  try {
    localStorage.setItem(GUEST_SONG_KEY, utcDay())
  } catch {
    // Private windows can refuse storage; the backend still refuses a second song
  }
  for (const listener of guestListeners) {
    listener()
  }
}

const subscribeGuestSong = (listener: () => void) => {
  guestListeners.add(listener)
  return () => {
    guestListeners.delete(listener)
  }
}

// What the person on the page may do. `newSong` is false only when we know a request would be refused
// `ready` is false until the sign-in check answers; until then everyone looks like a guest
export type Access =
  | { kind: 'guest'; newSong: boolean; admin: false; ready: boolean }
  | {
      kind: 'user'
      newSong: boolean
      admin: boolean
      quota: Quota
      invite: Invite
      ready: true
    }

export const useAccess = (): Access => {
  const { data, isPending } = useMe()
  const guestUsed = useSyncExternalStore(subscribeGuestSong, guestSongUsed)
  const user = data?.user ?? null
  if (user === null || data?.quota === undefined) {
    return {
      admin: false,
      kind: 'guest',
      newSong: !guestUsed,
      ready: !isPending,
    }
  }
  const { quota } = data
  return {
    admin: user.role === 'admin',
    // A Worker from before invites sends none: nothing to ask for
    invite: data.invite ?? { invited: true, requested: false },
    kind: 'user',
    newSong: quota.limit === null || quota.used < quota.limit,
    quota,
    ready: true,
  }
}

// Refusals that signing in would fix
export const SIGN_IN_CODES = new Set([
  'sign_in_required',
  'guest_limit',
  'guests_full',
])

// Why a signed-in user can't start a new song, for the places that hide the button
export const noSongReason = (quota: Quota) => {
  if (quota.limit === 0) {
    return 'Generating songs is invite-only for now.'
  }
  const next = new Date(quota.resetsAt).toLocaleString([], {
    hour: 'numeric',
    minute: '2-digit',
    weekday: 'short',
  })
  return quota.limit === 1
    ? `You've used today's song. Next at ${next}.`
    : `You've generated ${quota.limit} songs in the last 24 hours. More at ${next}.`
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
