import { expect, test } from 'bun:test'

import {
  ACCOUNT_PER_DAY,
  changeFeedback,
  listResolved,
  markResolved,
  NETWORK_PER_DAY,
  parseFeedback,
  pruneFeedbackCounts,
} from './feedback'
import worker from './index'
import { migratedD1, sessionCookie } from './test-d1'

const SECRET = 'test-secret-test-secret-test-secret'
const DAY = 86_400_000

// The Worker over a migrated database with one account, 'me', and its signed-in cookie
const setup = async () => {
  const { db, sqlite } = migratedD1()
  await db
    .prepare(
      `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       values ('me', 'Me', 'me@x', 1, 0, 0)`
    )
    .run()
  const cookie = await sessionCookie(db, SECRET, 'me')
  const env = {
    BETTER_AUTH_SECRET: SECRET,
    BETTER_AUTH_URL: 'http://localhost:5173',
    DB: db,
    GOOGLE_CLIENT_ID: 'x',
    GOOGLE_CLIENT_SECRET: 'x',
    INTERNAL_SECRET: 'internal',
    TRUSTED_ORIGINS: 'http://localhost:5173',
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the feedback routes never call it
  const ctx = { waitUntil: () => null } as unknown as ExecutionContext
  // The answer's status
  const send = async (
    body: Record<string, unknown>,
    { signedIn = false, ip = '203.0.113.7' } = {}
  ) => {
    const response = await worker.fetch(
      new Request('http://localhost/api/feedback', {
        body: JSON.stringify({
          message: 'The lyrics drift',
          subject: 'Sync',
          ...body,
        }),
        headers: {
          'cf-connecting-ip': ip,
          'content-type': 'application/json',
          ...(signedIn ? { cookie } : {}),
        },
        method: 'POST',
      }),
      env,
      ctx
    )
    return response.status
  }
  const rows = () =>
    sqlite
      .query<Record<string, unknown>, []>(
        `select * from "feedback" order by "id"`
      )
      .all()
  const counts = () =>
    sqlite
      .query<Record<string, unknown>, []>(`select * from "feedbackCount"`)
      .all()
  return { counts, db, rows, send }
}

test('a subject, a message and whether it is anonymous are needed; the hidden field is a bot', () => {
  expect(
    parseFeedback({ anonymous: false, message: ' Hi there ', subject: ' Bug ' })
  ).toEqual({
    feedback: { anonymous: false, message: 'Hi there', subject: 'Bug' },
    ok: true,
  })
  expect(parseFeedback({ message: 'Hi there', subject: 'Bug' }).ok).toBe(false)
  expect(
    parseFeedback({ anonymous: true, message: 'x', subject: 'Bug' }).ok
  ).toBe(false)
  expect(
    parseFeedback({
      anonymous: true,
      message: 'Hi there',
      subject: 'Bug',
      website: 'spam.biz',
    })
  ).toEqual({ code: 'trap', ok: false })
})

test('anonymous feedback from a signed-in account keeps nothing about its sender, and its counts name no message', async () => {
  const { counts, rows, send } = await setup()
  expect(await send({ anonymous: true }, { signedIn: true })).toBe(201)
  const [row] = rows()
  expect(row?.userId).toBeNull()
  // The row's columns: nothing else could hold a sender
  expect(Object.keys(row ?? {}).toSorted()).toEqual([
    'createdAt',
    'dismissedAt',
    'droppedAt',
    'id',
    'message',
    'resolvedAt',
    'seenAt',
    'subject',
    'userId',
  ])
  // One count for the account, one for the network: a hashed key, the day and a number, nothing that names the
  // message, the account or the address
  const kept = counts()
  expect(kept).toHaveLength(2)
  for (const count of kept) {
    expect(Object.keys(count).toSorted()).toEqual(['day', 'key', 'n'])
    expect(JSON.stringify(count)).not.toMatch(/me|203\.0\.113/u)
  }
})

test('signed feedback keeps the account; from a request with no session it is refused, never kept anonymous', async () => {
  const { rows, send } = await setup()
  expect(await send({ anonymous: false }, { signedIn: true })).toBe(201)
  expect(rows()[0]?.userId).toBe('me')
  expect(await send({ anonymous: false })).toBe(401)
  expect(await send({ anonymous: true })).toBe(201)
  expect(rows().map((row) => row.userId)).toEqual(['me', null])
})

test('the daily limits count anonymous and signed sends alike, per account and per network, and reset the next day', async () => {
  const { counts, db, send } = await setup()
  for (let i = 0; i < ACCOUNT_PER_DAY; i += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- sends are counted in order
    await send(
      { anonymous: i % 2 === 0 },
      { ip: `198.51.100.${i}`, signedIn: true }
    )
  }
  // The account is at its limit on any network
  expect(
    await send({ anonymous: true }, { ip: '198.51.100.99', signedIn: true })
  ).toBe(429)
  // A guest on one network
  for (let i = 0; i < NETWORK_PER_DAY; i += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- as above
    expect(await send({ anonymous: true }, { ip: '192.0.2.1' })).toBe(201)
  }
  expect(await send({ anonymous: true }, { ip: '192.0.2.1' })).toBe(429)
  // The next day's prune leaves no count behind
  await pruneFeedbackCounts(db, Date.now() + DAY)
  expect(counts()).toEqual([])
})

test('resolving signed feedback notifies its sender until dismissed; dropping and anonymous feedback notify nobody', async () => {
  const { db, rows, send } = await setup()
  await send({ anonymous: false, subject: 'One' }, { signedIn: true })
  await send({ anonymous: false, subject: 'Two' }, { signedIn: true })
  await send({ anonymous: true, subject: 'Three' }, { signedIn: true })
  const [one, two, three] = rows().map((row) => Number(row.id))
  const now = Date.now()
  for (const id of [one, two, three]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- in order
    await changeFeedback(db, id ?? 0, 'resolve', now)
  }
  await changeFeedback(db, two ?? 0, 'drop', now)
  expect(await listResolved(db, 'me', now)).toEqual([
    { id: one ?? 0, resolvedAt: now, seen: false, subject: 'One' },
  ])
  await markResolved(db, 'me', { ids: [one ?? 0], upTo: now }, 'seen', now)
  const [seen] = await listResolved(db, 'me', now)
  expect(seen?.seen).toBe(true)
  // Seen, it leaves on its own three days later, as a fixed report does
  expect(await listResolved(db, 'me', now + 3 * DAY + 1)).toEqual([])
  await markResolved(db, 'me', { ids: [one ?? 0], upTo: now }, 'dismissed', now)
  expect(await listResolved(db, 'me', now)).toEqual([])
  // Reopened and resolved again: back in the list, unseen
  await changeFeedback(db, one ?? 0, 'reopen', now)
  await changeFeedback(db, one ?? 0, 'resolve', now + 1)
  expect(await listResolved(db, 'me', now)).toEqual([
    { id: one ?? 0, resolvedAt: now + 1, seen: false, subject: 'One' },
  ])
})
