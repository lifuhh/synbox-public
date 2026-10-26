import type { Database } from 'bun:sqlite'
import { beforeEach, expect, test } from 'bun:test'

import {
  contactAllowed,
  emailContact,
  MESSAGE_MAX,
  networkOf,
  parseContact,
  saveContact,
  SENDER_PER_DAY,
  SUBJECT_MAX,
} from './contact'
import type { ContactMessage, EmailSender } from './contact'
import { migratedD1 } from './test-d1'

let db: D1Database
let sqlite: Database
const now = Date.parse('2026-10-26T10:00:00Z')
const HOUR = 3_600_000
const message: ContactMessage = {
  message: 'The song page froze on my phone',
  replyTo: null,
  subject: 'Bug',
}

beforeEach(() => {
  ;({ db, sqlite } = migratedD1())
})

const rows = () =>
  sqlite
    .query<{ emailedAt: number | null; emailError: string | null }, []>(
      `select "emailedAt", "emailError" from "contactMessage" order by "id"`
    )
    .all()

const ME = 'me@example.com'

test('a subject and a message are needed, within their lengths', () => {
  expect(parseContact({ message: 'Hello there', subject: ' Hi ' }, ME)).toEqual(
    {
      contact: { message: 'Hello there', replyTo: ME, subject: 'Hi' },
      ok: true,
    }
  )
  expect(parseContact({ message: 'Hello there', subject: '' }, ME).ok).toBe(
    false
  )
  expect(parseContact({ message: 'x', subject: 'Hi' }, ME).ok).toBe(false)
  expect(
    parseContact({ message: 'Hello', subject: 'x'.repeat(SUBJECT_MAX + 1) }, ME)
      .ok
  ).toBe(false)
  expect(
    parseContact({ message: 'x'.repeat(MESSAGE_MAX + 1), subject: 'Hi' }, ME).ok
  ).toBe(false)
  expect(parseContact(null, ME).ok).toBe(false)
})

test("the reply address is the account's, whatever the form sends", () => {
  const parsed = parseContact(
    {
      message: 'Hello there',
      replyTo: 'someone-else@example.com',
      subject: 'Hi',
    },
    ME
  )
  expect(parsed).toEqual({
    contact: { message: 'Hello there', replyTo: ME, subject: 'Hi' },
    ok: true,
  })
})

test('the hidden field filled in is a bot, told apart from a bad request', () => {
  expect(
    parseContact(
      { message: 'Buy now', subject: 'Deal', website: 'spam.biz' },
      ME
    )
  ).toEqual({ code: 'trap', ok: false })
})

test('an account gets a few a day, others are unaffected, and the day rolls over', async () => {
  const network = await networkOf('203.0.113.7')
  await Promise.all(
    Array.from(
      { length: SENDER_PER_DAY },
      async (_, index) =>
        await saveContact(db, message, 'u:alice', network, now - index)
    )
  )
  expect(await contactAllowed(db, 'u:alice', now)).toBe(false)
  // Another account on the same network still has room
  expect(await contactAllowed(db, 'u:bob', now)).toBe(true)
  // A day later Alice has room again
  expect(await contactAllowed(db, 'u:alice', now + 25 * HOUR)).toBe(true)
})

test('the network is kept as a hash, never the address, and the same address hashes the same', async () => {
  const hashed = await networkOf('203.0.113.7')
  expect(hashed).not.toContain('203')
  expect(hashed).toBe(await networkOf('203.0.113.7'))
  expect(hashed).not.toBe(await networkOf('203.0.113.8'))
})

test('a message the email could not carry stays kept, with the reason', async () => {
  const id = await saveContact(db, message, null, 'n', now)
  const failing: EmailSender = {
    send: async () => {
      await Promise.resolve()
      throw new Error('destination not verified')
    },
  }
  await emailContact(
    db,
    {
      CONTACT_FROM: 'from@example.com',
      CONTACT_TO: 'to@example.com',
      EMAIL: failing,
    },
    id ?? 0,
    message,
    null,
    () => now
  )
  expect(rows()).toEqual([
    { emailError: 'destination not verified', emailedAt: null },
  ])
})

test('an unconfigured email keeps the message; a configured one sends it to CONTACT_TO with the reply address', async () => {
  const first = await saveContact(db, message, null, 'n', now)
  await emailContact(db, {}, first ?? 0, message, null, () => now)
  const sent: unknown[] = []
  const sender: EmailSender = {
    // oxlint-disable-next-line eslint/require-await -- the binding's send is async; this fake answers at once
    send: async (mail) => {
      sent.push(mail)
      return { messageId: 'm1' }
    },
  }
  const withReply = { ...message, replyTo: 'fan@example.com' }
  const second = await saveContact(db, withReply, 'u:alice', 'n', now)
  await emailContact(
    db,
    {
      CONTACT_FROM: 'from@example.com',
      CONTACT_TO: 'to@example.com',
      EMAIL: sender,
    },
    second ?? 0,
    withReply,
    'u:alice',
    () => now + 1
  )
  expect(rows()).toEqual([
    { emailError: 'not_configured', emailedAt: null },
    { emailError: null, emailedAt: now + 1 },
  ])
  expect(sent).toEqual([
    expect.objectContaining({
      replyTo: 'fan@example.com',
      subject: '[Synbox] Bug',
      to: 'to@example.com',
    }),
  ])
})
