import { adminClient, jwtClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { z } from 'zod'

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

const meSchema = z.object({
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
export type Me = z.infer<typeof meSchema>

export const fetchMe = async (): Promise<Me> => {
  const response = await fetch('/api/me', { credentials: 'same-origin' })
  if (!response.ok) {
    throw new Error(`/api/me answered ${response.status}`)
  }
  return meSchema.parse(await response.json())
}

export const signInWithGoogle = async () =>
  await authClient.signIn.social({
    callbackURL: location.href,
    provider: 'google',
  })

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
