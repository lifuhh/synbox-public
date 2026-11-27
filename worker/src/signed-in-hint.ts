// A cookie the page can read that says only "this browser has a session", kept beside the session cookie (which the
// page can't read) and for as long. The app draws the signed-in page from its first frame on it
// (src/lib/auth.ts › rememberedAccount) when its own copy of the account is gone: Safari clears a site's storage after
// 7 days without a visit but keeps cookies the server set, and the first load after Google's sign-in has no copy yet.
// Only the look: every request is still checked against the session itself
export const SIGNED_IN_COOKIE = 'synbox_signed_in'

const SESSION_COOKIE = /^(?:__Secure-)?better-auth\.session_token=([^;]*)/u

// No max age: gone with the browser session, as a session cookie without one is
const set = (maxAgeSeconds: number | null) =>
  `${SIGNED_IN_COOKIE}=1; Path=/;${maxAgeSeconds === null ? '' : ` Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))};`} SameSite=Lax; Secure`

const clear = `${SIGNED_IN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`

export const hasSignedInHint = (cookieHeader: string | undefined) =>
  (cookieHeader ?? '')
    .split(';')
    .some((part) => part.trim() === `${SIGNED_IN_COOKIE}=1`)

// /api/me's header: the hint until the session expires, or cleared for a browser that has one and no session
export const signedInHintFor = (
  expiresAt: Date | null,
  now: number,
  hadHint: boolean
): string | null => {
  if (expiresAt !== null) {
    return set((expiresAt.getTime() - now) / 1000)
  }
  return hadHint ? clear : null
}

// An auth route's answer (the sign-in callback, sign-out), with the hint following the session cookie it sets or
// clears
export const withSignedInHint = (response: Response): Response => {
  const session = response.headers
    .getSetCookie()
    .map((cookie) => ({ cookie, match: SESSION_COOKIE.exec(cookie) }))
    .find(({ match }) => match !== null)
  if (session?.match == null) {
    return response
  }
  const maxAge = /;\s*Max-Age=(-?\d+)/iu.exec(session.cookie)?.[1]
  const cleared =
    session.match[1] === '' || (maxAge !== undefined && Number(maxAge) <= 0)
  const answer = new Response(response.body, response)
  answer.headers.append(
    'Set-Cookie',
    cleared ? clear : set(maxAge === undefined ? null : Number(maxAge))
  )
  return answer
}
