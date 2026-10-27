import type { Database } from 'bun:sqlite'
import { beforeEach, expect, test } from 'bun:test'

import { reserveGeneration } from './quota'
import { readSignals } from './signals'
import { migratedD1 } from './test-d1'

let db: D1Database
let sqlite: Database
const now = new Date('2026-10-21T10:00:00Z')
const LIMITS = { network: 30, site: 1000, user: 2 }

beforeEach(() => {
  ;({ db, sqlite } = migratedD1())
  const user = sqlite.prepare(
    `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "role", "banned") values (?, ?, ?, 1, ?, 0, 'user', 0)`
  )
  // An old account at home, a second one made this morning on the same network, and someone unrelated
  user.run('old', 'Old', 'old@x', now.getTime() - 30 * 86_400_000)
  user.run('alt', 'Alt', 'alt@x', now.getTime() - 3_600_000)
  user.run('other', 'Other', 'other@x', now.getTime() - 30 * 86_400_000)
})

const reserve = async (
  id: string,
  userId: string,
  network: string,
  client: string
) =>
  await reserveGeneration(
    db,
    {
      client,
      id,
      kind: 'new',
      network,
      owner: { id: userId, kind: 'user' },
      videoId: 'v',
    },
    LIMITS,
    now
  )

test('an alternate account on a shared network, scripted and at its limit on day one, is flagged; a normal user is not', async () => {
  const browser = 'Mozilla/5.0 (Macintosh) Safari/605.1.15'
  await reserve('o1', 'old', 'net-home', browser)
  await reserve('a1', 'alt', 'net-home', 'python-requests/2.32')
  await reserve('a2', 'alt', 'net-home', 'python-requests/2.32')
  await reserve('a3', 'alt', 'net-home', 'python-requests/2.32')
  await reserve('x1', 'other', 'net-cafe', browser)

  const { accounts, networks } = await readSignals(db, LIMITS.user, now)
  expect(accounts.map(({ id, flags }) => ({ flags, id }))).toEqual([
    {
      flags: ['automated', 'shared_network', 'new_at_limit', 'refused'],
      id: 'alt',
    },
    { flags: ['shared_network'], id: 'old' },
  ])
  expect(networks).toMatchObject([
    {
      accounts: [{ id: 'old' }, { id: 'alt' }],
      automated: true,
      key: 'net-home',
      refusals: 1,
      songs: 3,
    },
  ])
})
