import { expect, test } from 'bun:test'

import worker from './index'
import { migratedD1, sessionCookie } from './test-d1'

const SECRET = 'test-secret-test-secret-test-secret'
const DAY = 86_400_000

// Last active is accountStats' epoch milliseconds, or for an account it never saw, the session's ISO text. Both
// must sort as one timeline: SQLite puts every text above every number
test('accounts list most recently active first, whichever source dates them', async () => {
  const { db } = migratedD1()
  const now = Date.now()
  await db
    .prepare(
      `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "role")
       values ('boss', 'Boss', 'boss@x', 1, 0, 0, 'admin'), ('recent', 'R', 'r@x', 1, 0, 0, 'user'),
         ('quiet', 'Q', 'q@x', 1, 0, 0, 'user'), ('old', 'O', 'o@x', 1, 0, 0, 'user')`
    )
    .run()
  const cookie = await sessionCookie(db, SECRET, 'boss')
  // Never seen by accountStats: dated by its session alone
  await db
    .prepare(
      `insert into "session" ("id", "expiresAt", "token", "createdAt", "updatedAt", "userId")
       values ('q', ?1, 'q', ?1, ?1, 'quiet')`
    )
    .bind(new Date(now - 10 * DAY).toISOString())
    .run()
  await db
    .prepare(
      `insert into "accountStats" ("userId", "lastActiveAt") values ('recent', ?1), ('old', ?2)`
    )
    .bind(now - DAY, now - 30 * DAY)
    .run()
  const env = {
    BETTER_AUTH_SECRET: SECRET,
    BETTER_AUTH_URL: 'http://localhost:5173',
    DB: db,
    GOOGLE_CLIENT_ID: 'x',
    GOOGLE_CLIENT_SECRET: 'x',
    INTERNAL_SECRET: 'internal',
    TRUSTED_ORIGINS: 'http://localhost:5173',
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the admin routes never call it
  const ctx = { waitUntil: () => null } as unknown as ExecutionContext
  const response = await worker.fetch(
    new Request('http://localhost/api/admin/users', { headers: { cookie } }),
    env,
    ctx
  )
  const json: unknown = await response.json()
  const users: unknown =
    typeof json === 'object' && json !== null ? Reflect.get(json, 'users') : []
  const ids = Array.isArray(users)
    ? users.map((user: unknown): unknown =>
        typeof user === 'object' && user !== null
          ? Reflect.get(user, 'id')
          : null
      )
    : []
  // The admin's own request just marked it active
  expect(ids).toEqual(['boss', 'recent', 'quiet', 'old'])
})
