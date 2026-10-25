// The app's Contact form: anyone can send a subject and a message, with an address to reply to if they want one.
// Each message is kept for /admin and emailed to the owner through Cloudflare's send_email binding. Without an
// onboarded sending domain, that binding can only mail a verified destination address of the account, from an
// address on one of its Email Routing domains: CONTACT_TO (a secret) and CONTACT_FROM

export const SUBJECT_MAX = 120
export const MESSAGE_MAX = 4000
// Per sender (account or browser) and per network, a day: a person writing back and forth stays well under them
export const SENDER_PER_DAY = 5
export const NETWORK_PER_DAY = 10
const DAY_MS = 86_400_000
const EMAIL_MAX = 254
// Loose on purpose: the owner reads it, nothing is sent to it
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

export interface ContactMessage {
  subject: string
  message: string
  replyTo: string | null
}

// trap: the hidden field only bots fill in. The form answers it as sent, and nothing is kept
export type ParsedContact =
  | { ok: true; contact: ContactMessage }
  | { ok: false; code: 'bad_request' | 'trap' }

const text = (body: object, key: string) => {
  const value: unknown = Reflect.get(body, key)
  return typeof value === 'string' ? value.trim() : null
}

export const parseContact = (body: unknown): ParsedContact => {
  if (typeof body !== 'object' || body === null) {
    return { code: 'bad_request', ok: false }
  }
  if ((text(body, 'website') ?? '') !== '') {
    return { code: 'trap', ok: false }
  }
  const subject = text(body, 'subject') ?? ''
  const message = text(body, 'message') ?? ''
  const replyTo = text(body, 'replyTo') ?? ''
  if (
    subject === '' ||
    subject.length > SUBJECT_MAX ||
    message.length < 2 ||
    message.length > MESSAGE_MAX ||
    replyTo.length > EMAIL_MAX ||
    (replyTo !== '' && !EMAIL.test(replyTo))
  ) {
    return { code: 'bad_request', ok: false }
  }
  return {
    contact: { message, replyTo: replyTo === '' ? null : replyTo, subject },
    ok: true,
  }
}

// The sender's network for the daily limit, as a hash: the address itself is never kept
export const networkOf = async (address: string) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`contact:${address}`)
  )
  return [...new Uint8Array(digest).slice(0, 12)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const sentSince = async (
  db: D1Database,
  column: 'sender' | 'network',
  value: string,
  since: number
) =>
  Number(
    (await db
      .prepare(
        `select count(*) as "n" from "contactMessage" where "${column}" = ?1 and "createdAt" > ?2`
      )
      .bind(value, since)
      .first('n')) ?? 0
  )

export const contactAllowed = async (
  db: D1Database,
  sender: string | null,
  network: string,
  now: number
) =>
  (await sentSince(db, 'network', network, now - DAY_MS)) < NETWORK_PER_DAY &&
  (sender === null ||
    (await sentSince(db, 'sender', sender, now - DAY_MS)) < SENDER_PER_DAY)

export const saveContact = async (
  db: D1Database,
  contact: ContactMessage,
  sender: string | null,
  network: string,
  now: number
) => {
  const row = await db
    .prepare(
      `insert into "contactMessage" ("createdAt", "sender", "network", "subject", "message", "replyTo")
         values (?1, ?2, ?3, ?4, ?5, ?6) returning "id"`
    )
    .bind(
      now,
      sender,
      network,
      contact.subject,
      contact.message,
      contact.replyTo
    )
    .first<{ id: number }>()
  return row?.id ?? null
}

// The send_email binding, as much of it as this uses
export interface EmailSender {
  send: (message: {
    to: string
    from: { email: string; name: string }
    subject: string
    text: string
    replyTo?: string
  }) => Promise<unknown>
}

export interface ContactEnv {
  EMAIL?: EmailSender
  CONTACT_TO?: string
  CONTACT_FROM?: string
}

// Emails a kept message to the owner and records how it went. Never throws: a message that couldn't be emailed is
// still in /admin, with the reason
export const emailContact = async (
  db: D1Database,
  env: ContactEnv,
  id: number,
  contact: ContactMessage,
  sender: string | null,
  now: () => number
) => {
  let failure: string | null = null
  const { EMAIL: email, CONTACT_TO: to = '', CONTACT_FROM: from = '' } = env
  if (email === undefined || to === '' || from === '') {
    failure = 'not_configured'
  } else {
    try {
      await email.send({
        from: { email: from, name: 'Synbox Contact' },
        subject: `[Synbox] ${contact.subject}`,
        text: [
          contact.message,
          '',
          `Reply to: ${contact.replyTo ?? 'none given'}`,
          `From: ${sender ?? 'a guest'}`,
        ].join('\n'),
        to,
        ...(contact.replyTo === null ? {} : { replyTo: contact.replyTo }),
      })
    } catch (error) {
      failure =
        error instanceof Error ? error.message.slice(0, 200) : 'send_failed'
    }
  }
  await db
    .prepare(
      `update "contactMessage" set "emailedAt" = ?2, "emailError" = ?3 where "id" = ?1`
    )
    .bind(id, failure === null ? now() : null, failure)
    .run()
}

export const listContacts = async (db: D1Database, limit = 100) => {
  const { results } = await db
    .prepare(
      `select c."id", c."createdAt", c."sender", c."subject", c."message", c."replyTo", c."emailedAt",
           c."emailError", u."email" as "accountEmail", u."name" as "accountName"
         from "contactMessage" c
         left join "user" u on c."sender" = 'u:' || u."id"
         order by c."createdAt" desc limit ?1`
    )
    .bind(limit)
    .all()
  return results
}
