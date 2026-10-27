import type { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'

import { emailAutoPause } from './auto-pause'
import type { EmailSender } from './contact'
import { claimGuestSong } from './guest-song'
import type { Owner, SiteTrip } from './quota'
import {
  checkGeneration,
  finishGeneration,
  getQuota,
  localDay,
  readGenerationSettings,
  reserveGeneration,
  setGenerationEnabled,
  setTimeZone,
} from './quota'
import { migratedD1 } from './test-d1'

let db: D1Database
let sqlite: Database
const now = new Date('2026-10-21T10:00:00Z')
const LIMITS = { network: 100, site: 1000, user: 2 }
const reserve = async (id: string, userId = 'u1', videoId = 'v') =>
  await reserveGeneration(
    db,
    { id, kind: 'new', owner: { id: userId, kind: 'user' }, videoId },
    LIMITS,
    now
  )
const reserveAsGuest = async (id: string, key: string) =>
  await reserveGeneration(
    db,
    { id, kind: 'new', owner: { key, kind: 'guest' }, videoId: 'v' },
    LIMITS,
    now
  )

const check = async (owner: Owner) =>
  await checkGeneration(db, { kind: 'new', owner, videoId: 'v' }, LIMITS, now)

beforeEach(() => {
  ;({ db, sqlite } = migratedD1())
  const user = sqlite.prepare(
    `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "role", "banned") values (?, 'n', ?, 1, 0, 0, ?, ?)`
  )
  user.run('u1', 'a@x', 'user', 0)
  user.run('admin', 'b@x', 'admin', 0)
  user.run('banned', 'c@x', 'user', 1)
})

test('the daily limit holds and a reconnect is free', async () => {
  expect(await reserve('r1')).toEqual({ outcome: 'reserved' })
  expect(await reserve('r1')).toEqual({ outcome: 'replay' })
  expect(await reserve('r2')).toEqual({ outcome: 'reserved' })
  expect(await reserve('r3')).toEqual({
    limit: 2,
    outcome: 'quota_exceeded',
    // No time zone reported yet: the day is UTC's
    resetsAt: '2026-10-22T00:00:00.000Z',
  })
  expect(await getQuota(db, 'u1', LIMITS, now)).toMatchObject({
    limit: 2,
    used: 2,
  })
})

test('a failed song gives its slot back, and trying it again takes a slot again', async () => {
  await reserve('r1')
  await reserve('r2')
  await finishGeneration(db, 'r2', { errorCode: 'x', status: 'failed' }, now)
  expect(await reserve('r3')).toEqual({ outcome: 'reserved' })
  expect(await reserve('r2')).toMatchObject({ outcome: 'quota_exceeded' })
  await finishGeneration(db, 'r3', { errorCode: 'x', status: 'failed' }, now)
  expect(await reserve('r2')).toEqual({ outcome: 'reserved' })
})

test('a request id never opens another video, another user, or a second run once it worked', async () => {
  await reserve('r1')
  expect(await reserve('r1', 'u1', 'other')).toEqual({ outcome: 'forbidden' })
  expect(await reserve('r1', 'admin')).toEqual({ outcome: 'forbidden' })
  await finishGeneration(
    db,
    'r1',
    { resultVersion: 3, status: 'succeeded' },
    now
  )
  expect(await reserve('r1')).toEqual({ outcome: 'already_finished' })
  expect(await finishGeneration(db, 'r1', { status: 'failed' }, now)).toBe(
    false
  )
})

test('an admin has no limit and a banned user is refused', async () => {
  expect(await reserve('a1', 'admin')).toEqual({ outcome: 'reserved' })
  expect(await reserve('a2', 'admin')).toEqual({ outcome: 'reserved' })
  expect(await reserve('a3', 'admin')).toEqual({ outcome: 'reserved' })
  expect(await reserve('b1', 'banned')).toEqual({ outcome: 'forbidden' })
})

test('an override replaces the default limit, and pausing stops everyone', async () => {
  sqlite.run(`insert into "quotaOverride" values ('u1', 0, null, 'admin', 0)`)
  expect(await reserve('r1')).toMatchObject({
    limit: 0,
    outcome: 'quota_exceeded',
  })
  sqlite.run(
    `update "appSetting" set "value" = '0' where "key" = 'generationEnabled'`
  )
  expect(await reserve('a1', 'admin')).toEqual({ outcome: 'generation_paused' })
})

test('an unlimited override lifts the limit, and removing it brings the default back', async () => {
  sqlite.run(
    `insert into "quotaOverride" values ('u1', null, null, 'admin', 0)`
  )
  expect(await reserve('r1')).toEqual({ outcome: 'reserved' })
  expect(await reserve('r2')).toEqual({ outcome: 'reserved' })
  expect(await reserve('r3')).toEqual({ outcome: 'reserved' })
  expect(await getQuota(db, 'u1', LIMITS, now)).toMatchObject({
    limit: null,
    used: 3,
  })
  sqlite.run(`delete from "quotaOverride" where "userId" = 'u1'`)
  expect(await reserve('r4')).toMatchObject({
    limit: 2,
    outcome: 'quota_exceeded',
  })
})

test("a guest's song is reserved only under its device's claim, and a reconnect takes nothing more", async () => {
  // No claim: a call that skipped the proxy, or a token the backend couldn't verify
  expect(await reserveAsGuest('g1', 'net-a')).toEqual({
    outcome: 'sign_in_required',
  })
  expect(
    await claimGuestSong(
      db,
      { deviceKey: 'device', requestId: 'g1', videoId: 'v' },
      now.getTime()
    )
  ).toBe(true)
  expect(await reserveAsGuest('g1', 'net-a')).toEqual({ outcome: 'reserved' })
  expect(await reserveAsGuest('g1', 'net-a')).toEqual({ outcome: 'replay' })
  expect(await reserveAsGuest('g2', 'net-a')).toEqual({
    outcome: 'sign_in_required',
  })
})

const reserveAt = async (id: string, at: Date) =>
  await reserveGeneration(
    db,
    { id, kind: 'new', owner: { id: 'u1', kind: 'user' }, videoId: 'v' },
    LIMITS,
    at
  )

test("a user's day ends at their own midnight, not 24 hours after their first song", async () => {
  // 10:00 UTC is 18:00 in Singapore
  await setTimeZone(db, 'u1', 'Asia/Singapore', 0)
  await reserve('r1')
  await reserve('r2')
  // Finished, so the hours below don't let them go as stalled
  await finishGeneration(db, 'r1', { status: 'succeeded' }, now)
  await finishGeneration(db, 'r2', { status: 'succeeded' }, now)
  expect(await reserve('r3')).toEqual({
    limit: 2,
    outcome: 'quota_exceeded',
    resetsAt: '2026-10-21T16:00:00.000Z',
  })
  expect(await reserveAt('r3', new Date('2026-10-21T15:59:59Z'))).toMatchObject(
    { outcome: 'quota_exceeded' }
  )
  expect(await reserveAt('r3', new Date('2026-10-21T16:00:00Z'))).toEqual({
    outcome: 'reserved',
  })
  expect(
    await getQuota(db, 'u1', LIMITS, new Date('2026-10-21T16:00:00Z'))
  ).toEqual({ limit: 2, resetsAt: '2026-10-22T16:00:00.000Z', used: 1 })
})

test('a local day follows daylight saving and survives an unknown zone', () => {
  // New York's day before the clocks go back (2026-11-01) is 25 hours long
  expect(
    localDay('America/New_York', new Date('2026-11-01T12:00:00Z'))
  ).toEqual({
    end: Date.parse('2026-11-02T05:00:00Z'),
    start: Date.parse('2026-11-01T04:00:00Z'),
  })
  expect(localDay('Not/AZone', new Date('2026-10-21T10:00:00Z'))).toEqual({
    end: Date.parse('2026-10-22T00:00:00Z'),
    start: Date.parse('2026-10-21T00:00:00Z'),
  })
})

test('a check answers what reserving would, and takes nothing', async () => {
  const user: Owner = { id: 'u1', kind: 'user' }
  const guest: Owner = { key: 'g1', kind: 'guest' }
  expect(await check(user)).toEqual({ outcome: 'allowed' })
  expect(await check(user)).toEqual({ outcome: 'allowed' })
  await reserve('r1')
  await reserve('r2')
  expect(await check(user)).toMatchObject({ outcome: 'quota_exceeded' })
  expect(await check({ id: 'admin', kind: 'user' })).toEqual({
    outcome: 'allowed',
  })
  expect(await check({ id: 'banned', kind: 'user' })).toEqual({
    outcome: 'forbidden',
  })
  // A guest's claim is the generation proxy's to check (guest-song.ts)
  expect(await check(guest)).toEqual({ outcome: 'allowed' })
  sqlite.run(
    `update "appSetting" set "value" = '0' where "key" = 'generationEnabled'`
  )
  expect(await check({ id: 'admin', kind: 'user' })).toEqual({
    outcome: 'generation_paused',
  })
})

const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000)

test('a generation nobody reports on for 15 minutes stops counting; one that reports keeps its slot', async () => {
  expect(await reserve('r1')).toEqual({ outcome: 'reserved' })
  expect(await reserve('r2')).toEqual({ outcome: 'reserved' })
  // r1 keeps reporting; r2 went quiet when the app was put away
  expect(
    await finishGeneration(
      db,
      'r1',
      { fraction: 0.4, stage: 'Separating the vocals', status: 'running' },
      later(10)
    )
  ).toBe(true)
  const at = later(20)
  expect(
    await reserveGeneration(
      db,
      {
        id: 'r3',
        kind: 'new',
        owner: { id: 'u1', kind: 'user' },
        videoId: 'v',
      },
      LIMITS,
      at
    )
  ).toEqual({ outcome: 'reserved' })
  const rows = sqlite
    .query(
      `select "id", "status", "errorCode", "stage", "fraction" from "generation" order by "id"`
    )
    .all()
  expect(rows).toEqual([
    {
      errorCode: null,
      fraction: 0.4,
      id: 'r1',
      stage: 'Separating the vocals',
      status: 'running',
    },
    {
      errorCode: 'abandoned',
      fraction: null,
      id: 'r2',
      stage: null,
      status: 'failed',
    },
    {
      errorCode: null,
      fraction: null,
      id: 'r3',
      stage: null,
      status: 'reserved',
    },
  ])
})

const user = (id: string): Owner => ({ id, kind: 'user' })

describe('alternate accounts on one network', () => {
  const NETWORK_LIMITS = { ...LIMITS, network: 3 }
  const reserveFrom = async (
    id: string,
    owner: Owner,
    network: string,
    client = 'Mozilla/5.0'
  ) =>
    await reserveGeneration(
      db,
      { client, id, kind: 'new', network, owner, videoId: 'v' },
      NETWORK_LIMITS,
      now
    )

  beforeEach(() => {
    const insert = sqlite.prepare(
      `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "role", "banned") values (?, 'n', ?, 1, 0, 0, 'user', 0)`
    )
    insert.run('u2', 'u2@x')
    insert.run('u3', 'u3@x')
    insert.run('vip', 'vip@x')
    sqlite.run(
      `insert into "quotaOverride" values ('vip', null, null, 'admin', 0)`
    )
  })

  test('share the network cap, whichever account asks', async () => {
    expect(await reserveFrom('a1', user('u1'), 'net-a')).toEqual({
      outcome: 'reserved',
    })
    expect(await reserveFrom('a2', user('u1'), 'net-a')).toEqual({
      outcome: 'reserved',
    })
    expect(await reserveFrom('b1', user('u2'), 'net-a')).toEqual({
      outcome: 'reserved',
    })
    // A fresh account on the same network finds the network full
    expect(await reserveFrom('c1', user('u3'), 'net-a')).toEqual({
      outcome: 'network_limit',
    })
    expect(
      await reserveFrom('g1', { key: 'net-a', kind: 'guest' }, 'net-a')
    ).toEqual({ outcome: 'sign_in_required' })
    // The same account elsewhere is not held back by net-a
    expect(await reserveFrom('c2', user('u3'), 'net-b')).toEqual({
      outcome: 'reserved',
    })
  })

  test('admins and No Limit accounts neither count nor get capped, and a failed song frees the slot', async () => {
    await reserveFrom('a1', user('u1'), 'net-a')
    await reserveFrom('a2', user('u1'), 'net-a')
    expect(await reserveFrom('v1', user('vip'), 'net-a')).toEqual({
      outcome: 'reserved',
    })
    expect(await reserveFrom('x1', user('admin'), 'net-a')).toEqual({
      outcome: 'reserved',
    })
    expect(await reserveFrom('b1', user('u2'), 'net-a')).toEqual({
      outcome: 'reserved',
    })
    expect(await reserveFrom('b2', user('u2'), 'net-a')).toEqual({
      outcome: 'network_limit',
    })
    await finishGeneration(db, 'a2', { status: 'failed' }, now)
    expect(await reserveFrom('b2', user('u2'), 'net-a')).toEqual({
      outcome: 'reserved',
    })
  })

  test('the check answers the network cap too, and a reserve refusal is recorded for the admin page', async () => {
    await reserveFrom('a1', user('u1'), 'net-a')
    await reserveFrom('a2', user('u1'), 'net-a')
    await reserveFrom('b1', user('u2'), 'net-a')
    expect(
      await checkGeneration(
        db,
        { kind: 'new', network: 'net-a', owner: user('u3'), videoId: 'v' },
        NETWORK_LIMITS,
        now
      )
    ).toEqual({ outcome: 'network_limit' })
    await reserveFrom('c1', user('u3'), 'net-a')
    await reserveFrom('a3', user('u1'), 'net-a')
    expect(
      sqlite
        .query(
          `select "code", "userId", "networkKey" from "refusal" order by "code"`
        )
        .all()
    ).toEqual([
      { code: 'network_limit', networkKey: 'net-a', userId: 'u3' },
      { code: 'quota_exceeded', networkKey: 'net-a', userId: 'u1' },
    ])
  })
})

// A time on the day `now` falls in
const at = (time: string) => new Date(`2026-10-21T${time}Z`)

describe("the site's daily ceiling", () => {
  const sent: { subject: string; text: string }[] = []
  const emails: Promise<void>[] = []
  let failing = false
  const sender: EmailSender = {
    // oxlint-disable-next-line eslint/require-await -- the binding's send is async; this fake answers at once
    send: async (mail) => {
      if (failing) {
        throw new Error('send failed')
      }
      sent.push(mail)
    },
  }
  const onTrip = (trip: SiteTrip) => {
    emails.push(
      emailAutoPause(
        { CONTACT_FROM: 'from', CONTACT_TO: 'to', EMAIL: sender },
        trip,
        'https://example.test/admin'
      )
    )
  }
  const reserveUnder = async (
    site: number,
    id: string,
    owner: Owner,
    when = now
  ) =>
    await reserveGeneration(
      db,
      { id, kind: 'new', owner, videoId: 'v' },
      { ...LIMITS, site },
      when,
      onTrip
    )

  beforeEach(() => {
    sent.length = 0
    emails.length = 0
    failing = false
    const insert = sqlite.prepare(
      `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "role", "banned") values (?, 'n', ?, 1, 0, 0, 'user', 0)`
    )
    for (const id of ['u2', 'u3', 'u4']) {
      insert.run(id, `${id}@x`)
    }
  })

  test('the request that would pass it pauses everyone but admins, and only one of many at once emails', async () => {
    // An admin's songs count toward it, though no ceiling holds them
    await reserveUnder(3, 'a1', user('admin'))
    await reserveUnder(3, 'a2', user('admin'))
    const outcomes = await Promise.all(
      ['u1', 'u2', 'u3', 'u4'].map(
        async (id) => await reserveUnder(3, `r-${id}`, user(id))
      )
    )
    await Promise.all(emails)
    expect(outcomes.filter((o) => o.outcome === 'reserved')).toHaveLength(1)
    expect(
      outcomes.filter((o) => o.outcome === 'generation_paused')
    ).toHaveLength(3)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.subject).toBe(
      'Synbox paused new songs: 3 today hit the daily ceiling'
    )
    expect(sent[0]?.text).toContain('at 10:00 UTC after 3 generations today')
    expect(await readGenerationSettings(db)).toMatchObject({
      autoPause: { at: now.getTime(), count: 3 },
      enabled: false,
    })
    expect(await reserveUnder(3, 'a3', user('admin'))).toEqual({
      outcome: 'reserved',
    })
    expect(
      await checkGeneration(
        db,
        { kind: 'new', owner: { key: 'g', kind: 'guest' }, videoId: 'v' },
        { ...LIMITS, site: 3 },
        now
      )
    ).toEqual({ outcome: 'generation_paused' })
  })

  test('a failed email leaves the pause; it holds past midnight, and Resume restarts the count from its time', async () => {
    failing = true
    await reserveUnder(2, 'r1', user('u1'))
    await reserveUnder(2, 'r2', user('u2'))
    expect(await reserveUnder(2, 'r3', user('u3'))).toEqual({
      outcome: 'generation_paused',
    })
    await Promise.all(emails)
    expect(emails).toHaveLength(1)
    expect(sent).toHaveLength(0)
    expect(
      await reserveUnder(2, 'r3', user('u3'), new Date('2026-10-22T08:00:00Z'))
    ).toEqual({ outcome: 'generation_paused' })

    // The same day: two songs since midnight, none since the Resume
    await setGenerationEnabled(db, true, at('10:30:00').getTime())
    expect(await readGenerationSettings(db)).toMatchObject({
      autoPause: null,
      enabled: true,
    })
    expect(await reserveUnder(2, 'r3', user('u3'), at('11:00:00'))).toEqual({
      outcome: 'reserved',
    })
    expect(await reserveUnder(2, 'r4', user('u4'), at('11:01:00'))).toEqual({
      outcome: 'reserved',
    })
    expect(await reserveUnder(2, 'r5', user('u1'), at('11:02:00'))).toEqual({
      outcome: 'generation_paused',
    })
  })
})
