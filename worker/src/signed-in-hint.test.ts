import { describe, expect, test } from 'bun:test'

import { withSignedInHint } from './signed-in-hint'

const answer = (...cookies: string[]) => {
  const headers = new Headers({ Location: '/' })
  for (const cookie of cookies) {
    headers.append('Set-Cookie', cookie)
  }
  return new Response(null, { headers, status: 302 })
}

const hint = (response: Response) =>
  response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('synbox_signed_in='))

describe('withSignedInHint', () => {
  test('follows the session cookie Better Auth sets or clears', () => {
    const signedIn = withSignedInHint(
      answer(
        '__Secure-better-auth.state=; Max-Age=0; Path=/',
        '__Secure-better-auth.session_token=abc.def; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax'
      )
    )
    expect(signedIn.status).toBe(302)
    expect(hint(signedIn)).toContain(
      'synbox_signed_in=1; Path=/; Max-Age=604800;'
    )

    const signedOut = withSignedInHint(
      answer(
        '__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure'
      )
    )
    expect(hint(signedOut)).toContain('synbox_signed_in=; Path=/; Max-Age=0;')
  })

  test('leaves answers that touch no session alone', () => {
    expect(
      hint(
        withSignedInHint(answer('__Secure-better-auth.state=x; Max-Age=600'))
      )
    ).toBeUndefined()
  })
})
