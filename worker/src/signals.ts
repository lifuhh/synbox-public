// Signs that someone is working around the song limit, for the admin page's Signals tab: several accounts on one
// network, a scripted or headless client, a brand-new account that hit the limit on its first day, and
// reservations turned away at a limit. Each is a lead for a person to look at, never a block on its own

export type Flag = 'automated' | 'shared_network' | 'new_at_limit' | 'refused'

export interface SignalAccount {
  id: string
  name: string
  email: string
  createdAt: number
  songs: number
  refusals: number
  client: string | null
  flags: Flag[]
}

export interface SignalNetwork {
  // The first characters of the network's keyed hash: enough to tell networks apart, never the address
  key: string
  accounts: { id: string; name: string; email: string }[]
  guestSongs: number
  songs: number
  refusals: number
  automated: boolean
}

export interface Signals {
  since: number
  accounts: SignalAccount[]
  networks: SignalNetwork[]
}

const WEEK_MS = 7 * 86_400_000
const DAY_MS = 86_400_000

// Clients a person in a browser doesn't send: headless browsers, browser drivers and HTTP libraries. An empty
// user agent counts too. `[webdriver]` is what the backend adds when the page reported navigator.webdriver
const AUTOMATION =
  /HeadlessChrome|PhantomJS|Playwright|Puppeteer|Selenium|webdriver|python-requests|python-httpx|aiohttp|curl\/|Wget|node-fetch|undici|axios|Go-http-client|okhttp|Java\/|libwww|Scrapy|\bbot\b|spider|crawler/iu

export const isAutomated = (client: string | null) =>
  client !== null && (client.trim() === '' || AUTOMATION.test(client))

interface Row {
  userId: string | null
  guestKey: string | null
  networkKey: string | null
  client: string | null
  createdAt: number
  status: string
  name: string | null
  email: string | null
  userCreatedAt: number | string | null
}

interface RefusalRow {
  userId: string | null
  networkKey: string | null
  client: string | null
}

// Better Auth stores dates as text or epoch milliseconds
const toMs = (value: number | string | null) => {
  if (typeof value === 'number') {
    return value
  }
  return value === null ? 0 : Date.parse(value)
}

const tally = <K>(map: Map<K, number>, key: K) => {
  map.set(key, (map.get(key) ?? 0) + 1)
}

// Everything the week's rows say, per account and per network
class Tally {
  users = new Map<string, Row>()
  songs = new Map<string, number>()
  firstDaySongs = new Map<string, number>()
  clients = new Map<string, string>()
  automatedUsers = new Set<string>()
  userRefusals = new Map<string, number>()
  networkUsers = new Map<string, Set<string>>()
  networkSongs = new Map<string, number>()
  networkGuestSongs = new Map<string, number>()
  networkRefusals = new Map<string, number>()
  automatedNetworks = new Set<string>()

  addNetworkRow(row: Row & { networkKey: string }) {
    if (row.userId !== null) {
      const members = this.networkUsers.get(row.networkKey) ?? new Set()
      members.add(row.userId)
      this.networkUsers.set(row.networkKey, members)
    }
    if (row.status !== 'failed') {
      tally(this.networkSongs, row.networkKey)
      if (row.guestKey !== null) {
        tally(this.networkGuestSongs, row.networkKey)
      }
    }
    if (isAutomated(row.client)) {
      this.automatedNetworks.add(row.networkKey)
    }
  }

  addUserRow(row: Row & { userId: string }) {
    this.users.set(row.userId, row)
    if (row.client !== null) {
      this.clients.set(row.userId, row.client)
    }
    if (isAutomated(row.client)) {
      this.automatedUsers.add(row.userId)
    }
    if (row.status !== 'failed') {
      tally(this.songs, row.userId)
      if (row.createdAt - toMs(row.userCreatedAt) < DAY_MS) {
        tally(this.firstDaySongs, row.userId)
      }
    }
  }

  addRefusal(refusal: RefusalRow) {
    const automated = isAutomated(refusal.client)
    if (refusal.userId !== null) {
      tally(this.userRefusals, refusal.userId)
      if (automated) {
        this.automatedUsers.add(refusal.userId)
      }
    }
    if (refusal.networkKey !== null) {
      tally(this.networkRefusals, refusal.networkKey)
      if (automated) {
        this.automatedNetworks.add(refusal.networkKey)
      }
    }
  }

  // Accounts that generated from a network another account also used
  sharedUsers() {
    const shared = new Set<string>()
    for (const members of this.networkUsers.values()) {
      if (members.size > 1) {
        for (const id of members) {
          shared.add(id)
        }
      }
    }
    return shared
  }

  flagsOf(id: string, shared: Set<string>, userLimit: number): Flag[] {
    const flags: [Flag, boolean][] = [
      ['automated', this.automatedUsers.has(id)],
      ['shared_network', shared.has(id)],
      [
        'new_at_limit',
        userLimit > 0 && (this.firstDaySongs.get(id) ?? 0) >= userLimit,
      ],
      ['refused', this.userRefusals.has(id)],
    ]
    return flags.filter(([, on]) => on).map(([flag]) => flag)
  }

  accounts(userLimit: number): SignalAccount[] {
    const shared = this.sharedUsers()
    return [...this.users]
      .map(([id, row]) => ({
        client: this.clients.get(id) ?? null,
        createdAt: toMs(row.userCreatedAt),
        email: row.email ?? '',
        flags: this.flagsOf(id, shared, userLimit),
        id,
        name: row.name ?? 'Deleted Account',
        refusals: this.userRefusals.get(id) ?? 0,
        songs: this.songs.get(id) ?? 0,
      }))
      .filter(({ flags }) => flags.length > 0)
      .toSorted((a, b) => b.flags.length - a.flags.length || b.songs - a.songs)
  }

  networks(): SignalNetwork[] {
    const keys = new Set([
      ...this.networkUsers.keys(),
      ...this.networkRefusals.keys(),
      ...this.automatedNetworks,
    ])
    return [...keys]
      .map((key) => ({
        accounts: [...(this.networkUsers.get(key) ?? [])].map((id) => {
          const row = this.users.get(id)
          return {
            email: row?.email ?? '',
            id,
            name: row?.name ?? 'Deleted Account',
          }
        }),
        automated: this.automatedNetworks.has(key),
        guestSongs: this.networkGuestSongs.get(key) ?? 0,
        key: key.slice(0, 8),
        refusals: this.networkRefusals.get(key) ?? 0,
        songs: this.networkSongs.get(key) ?? 0,
      }))
      .filter(
        (network) =>
          network.accounts.length > 1 ||
          network.refusals > 0 ||
          network.automated
      )
      .toSorted(
        (a, b) => b.accounts.length - a.accounts.length || b.songs - a.songs
      )
  }
}

export const readSignals = async (
  db: D1Database,
  userLimit: number,
  now = new Date()
): Promise<Signals> => {
  const since = now.getTime() - WEEK_MS
  const { results: rows } = await db
    .prepare(
      `select g."userId", g."guestKey", g."networkKey", g."client", g."createdAt", g."status",
         u."name", u."email", u."createdAt" as "userCreatedAt"
       from "generation" g left join "user" u on u."id" = g."userId"
       where g."createdAt" > ?1`
    )
    .bind(since)
    .all<Row>()
  const { results: refusals } = await db
    .prepare(
      `select "userId", "networkKey", "client" from "refusal" where "createdAt" > ?1`
    )
    .bind(since)
    .all<RefusalRow>()
  const found = new Tally()
  for (const row of rows) {
    const { networkKey, userId } = row
    if (networkKey !== null) {
      found.addNetworkRow({ ...row, networkKey })
    }
    if (userId !== null) {
      found.addUserRow({ ...row, userId })
    }
  }
  for (const refusal of refusals) {
    found.addRefusal(refusal)
  }
  return {
    accounts: found.accounts(userLimit),
    networks: found.networks(),
    since,
  }
}
