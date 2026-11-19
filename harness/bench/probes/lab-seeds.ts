// What a fresh lab browser lacks and some pages need: a signed-in listener, an admin with the admin console's data,
// and a playlist in the browser's storage. Answered in the page: nothing reaches the auth Worker, and a write gets a
// bare 204. Every account, address and message here is made up (example.com); the songs are real library songs, by
// video id and title, so their titles and thumbnails load as they would for a listener

import type { Page } from 'playwright'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

type Role = 'user' | 'admin'

const ME: Record<Role, unknown> = {
  admin: {
    quota: {
      limit: null,
      request: null,
      resetsAt: '2099-01-01T00:00:00.000Z',
      used: 0,
    },
    timeZone: 'UTC',
    user: {
      email: 'admin@example.com',
      id: 'bench-admin',
      image: null,
      name: 'Bench Admin',
      role: 'admin',
    },
  },
  user: {
    quota: {
      limit: 5,
      request: null,
      resetsAt: '2099-01-01T00:00:00.000Z',
      used: 2,
    },
    timeZone: 'UTC',
    user: {
      email: 'listener@example.com',
      id: 'bench',
      image: null,
      name: 'Bench',
      role: 'user',
    },
  },
}

// An empty library, as the auth Worker answers a new account
const ME_ROUTES: Record<string, unknown> = {
  '/api/me/feedback': { feedback: [] },
  '/api/me/fixes': { fixes: [] },
  '/api/me/library': { bookmarks: [], history: [], playlists: [] },
  '/api/me/prefs': { prefs: {} },
  '/api/me/songs': { songs: [] },
}

/**
 * Signed in, as the auth Worker answers: a listener with an empty library (the default), or an admin. Only GETs are
 * answered; a write (library or settings sync) gets a bare 204
 */
export const signIn = async (page: Page, role: Role = 'user') => {
  const routes: Record<string, unknown> = { ...ME_ROUTES, '/api/me': ME[role] }
  await page.route(/\/api\/me(?:\/|$|\?)/u, async (route) => {
    const request = route.request()
    const body = routes[new URL(request.url()).pathname]
    await (request.method() === 'GET' && body !== undefined
      ? route.fulfill({ json: body })
      : route.fulfill({ status: 204 }))
  })
}

const song = (videoId: string, title: string, author: string) => ({
  author,
  thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  title,
  videoId,
})

/** Songs in the library (the landing page's recommendations), for the playlist and the admin lists */
const SONGS = [
  song('ZRtdQ81jPUQ', 'YOASOBI「アイドル」 Official Music Video', 'YOASOBI'),
  song('sOiMD45QGLs', '【Ado】ギラギラ', 'Ado'),
  song(
    'Q5JytNgQzqk',
    'Novelbright - 愛とか恋とか [Official Music Video]',
    'Novelbright'
  ),
  song('oZpYEEcvu5I', 'tuki.『晩餐歌』Official Music Video', 'tuki.(17)'),
  song(
    'kfpGkUFW-aM',
    'CHIHIRO - 冷たくしないでよ（Official MV）',
    'CHIHIRO official'
  ),
  song('K1Tz2yNmamI', 'YOASOBI「もう少しだけ」Official Music Video', 'YOASOBI'),
  song('sWff60PZytQ', 'tayori - 風のたより (Official Video)', 'tayori'),
]
const ids = SONGS.map((s) => s.videoId)

/** The stored playlist's id: its page is /playlists/<this> */
export const BENCH_PLAYLIST = 'bench-playlist'

/**
 * A guest's playlist of seven songs, in the browser's storage under the key the app keeps playlists in
 * (src/lib/library/store.ts › playlistsAtom), so /playlists/<BENCH_PLAYLIST> opens it. Set once per context, before
 * the app reads it
 */
export const seedPlaylist = async (page: Page) => {
  const at = Date.UTC(2026, 9, 1)
  const stored = JSON.stringify([
    {
      createdAt: at,
      id: BENCH_PLAYLIST,
      name: 'Late Night Drive',
      songs: SONGS,
      updatedAt: at + DAY,
    },
  ])
  await page.addInitScript((value) => {
    if (localStorage.getItem('playlists') === null) {
      localStorage.setItem('playlists', value)
    }
  }, stored)
}

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1'
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36'

/**
 * The admin console's answers (src/lib/admin-console.ts, the auth Worker's /api/admin routes), by path, with every
 * kind of row each tab draws: an admin, a blocked account and raised limits; songs running, done and failed both
 * ways; reports open, waiting for review, resolved and dropped; signals on accounts and networks; two weeks of usage;
 * feedback, messages and song requests. Times are relative to `now`, so "5m ago" reads the same on every run
 */
const adminConsole = (now: number): Record<string, unknown> => {
  const ago = (ms: number) => now - ms
  const people = [
    ['bench-admin', 'Bench Admin', 'admin@example.com'],
    ['u-commute', 'Morning Commute', 'commute@example.com'],
    ['u-karaoke', 'Karaoke Night', 'karaoke.night@example.com'],
    ['u-learner', 'Lyric Learner', 'learner@example.com'],
    ['u-quiet', 'Quiet Listener', 'quiet@example.com'],
    ['u-weekend', 'Weekend Singer', 'weekend@example.com'],
    ['u-blocked', 'Blocked Example', 'blocked@example.com'],
  ] as const
  const [admin, commute, karaoke, learner, quiet, weekend, blocked] = people
  const account = ([id, name, email]: (typeof people)[number]) => ({
    email,
    id,
    name,
  })
  // An account row: when it was last seen, then its plays, songs in the last day and songs in all
  const user = (
    who: (typeof people)[number],
    role: Role | null,
    dailyLimit: number | 'default' | 'unlimited',
    seen: number,
    [plays, songsLastDay, songsTotal]: [number, number, number],
    banned: number | null = null
  ) => ({
    ...account(who),
    banned,
    createdAt: ago(seen + 30 * DAY),
    dailyLimit,
    image: null,
    lastActiveAt: ago(seen),
    lastPlayAt: ago(seen + 4 * MINUTE),
    plays,
    role,
    songsLastDay,
    songsTotal,
  })
  const generation = (
    i: number,
    by: (typeof people)[number] | null,
    status: 'reserved' | 'running' | 'succeeded' | 'failed',
    extra: Record<string, unknown> = {}
  ) => ({
    createdAt: ago(i * 47 * MINUTE),
    email: by?.[2] ?? null,
    errorCode: null,
    fraction: null,
    guest: by === null ? 1 : 0,
    id: `gen-${i}`,
    kind: 'new',
    name: by?.[1] ?? null,
    resultVersion: status === 'succeeded' ? 1 : null,
    stage: null,
    status,
    videoId: ids[i % ids.length],
    ...extra,
  })
  return {
    '/api/admin/feedback': {
      feedback: [
        {
          anonymous: 0,
          createdAt: ago(3 * HOUR),
          droppedAt: null,
          email: learner[2],
          id: 3,
          message:
            'The romaji toggle is hard to find on my phone. A label next to the icon would help',
          name: learner[1],
          resolvedAt: null,
          subject: 'Romaji toggle',
        },
        {
          anonymous: 1,
          createdAt: ago(2 * DAY),
          droppedAt: null,
          email: null,
          id: 2,
          message: 'Love the karaoke colours. Could the lines be a bit larger?',
          name: null,
          resolvedAt: ago(DAY),
          subject: 'Bigger lines',
        },
      ],
    },
    '/api/admin/generations': {
      generations: [
        generation(0, karaoke, 'running', {
          fraction: 0.4,
          stage: 'align',
        }),
        generation(1, null, 'reserved'),
        generation(2, commute, 'succeeded'),
        generation(3, learner, 'failed', { errorCode: 'NotAJapaneseSong' }),
        generation(4, weekend, 'succeeded', { kind: 'regenerate' }),
        generation(5, null, 'succeeded'),
        generation(6, karaoke, 'failed', { errorCode: 'TimeoutError' }),
        generation(7, admin, 'succeeded', { kind: 'retime' }),
        generation(8, quiet, 'succeeded'),
        generation(9, commute, 'failed', { errorCode: 'abandoned' }),
      ],
    },
    '/api/admin/messages': {
      messages: [
        {
          accountEmail: null,
          accountName: null,
          createdAt: ago(5 * HOUR),
          emailError: null,
          emailedAt: ago(5 * HOUR),
          id: 2,
          message:
            'Could you add the rest of this album? The first two songs work great',
          replyTo: 'album.fan@example.com',
          sender: 'd:4f1c',
          subject: 'More songs from one album',
        },
        {
          accountEmail: weekend[2],
          accountName: weekend[1],
          createdAt: ago(4 * DAY),
          emailError: 'Mail service unavailable',
          emailedAt: null,
          id: 1,
          message:
            'Is there a way to slow a song down while keeping the lyrics in time?',
          replyTo: null,
          sender: weekend[0],
          subject: 'Practice speed',
        },
      ],
    },
    '/api/admin/quota-requests': {
      requests: [
        {
          createdAt: ago(40 * MINUTE),
          dailyLimit: 'default',
          decidedAt: null,
          email: learner[2],
          granted: null,
          id: 2,
          image: null,
          name: learner[1],
          note: 'Studying Japanese with a group; five songs a day runs out fast',
          status: 'open',
          userId: learner[0],
        },
        {
          createdAt: ago(6 * DAY),
          dailyLimit: 10,
          decidedAt: ago(5 * DAY),
          email: karaoke[2],
          granted: 10,
          id: 1,
          image: null,
          name: karaoke[1],
          note: 'Preparing a karaoke night playlist',
          status: 'approved',
          userId: karaoke[0],
        },
      ],
    },
    '/api/admin/reports': {
      reports: [
        {
          atSeconds: 74,
          build: 'bench',
          client: IPHONE,
          createdAt: ago(25 * MINUTE),
          dropReason: null,
          droppedAt: null,
          email: commute[2],
          guest: 0,
          id: 'rep-4',
          message: 'The chorus lines show about a second late',
          name: commute[1],
          resolution: null,
          resolvedAt: null,
          resolvedVersion: null,
          reviewAt: null,
          reviewNote: null,
          version: 2,
          videoId: ids[0],
        },
        {
          atSeconds: 131,
          build: 'bench',
          client: ANDROID_CHROME,
          createdAt: ago(9 * HOUR),
          dropReason: null,
          droppedAt: null,
          email: null,
          guest: 1,
          id: 'rep-3',
          message: 'Furigana on the second verse reads wrong',
          name: null,
          resolution: null,
          resolvedAt: null,
          resolvedVersion: null,
          reviewAt: ago(8 * HOUR),
          reviewNote: 'The reading matches the singer; left for a person',
          version: 1,
          videoId: ids[1],
        },
        {
          atSeconds: null,
          build: 'bench',
          client: MAC_CHROME,
          createdAt: ago(2 * DAY),
          dropReason: null,
          droppedAt: null,
          email: quiet[2],
          guest: 0,
          id: 'rep-2',
          message: 'The English translation stops after line 12',
          name: quiet[1],
          resolution: 'Translated lines 12 to 30 again',
          resolvedAt: ago(DAY),
          resolvedVersion: 3,
          reviewAt: null,
          reviewNote: null,
          version: 2,
          videoId: ids[2],
        },
        {
          atSeconds: 12,
          build: 'bench',
          client: IPHONE,
          createdAt: ago(3 * DAY),
          dropReason: 'duplicate',
          droppedAt: ago(3 * DAY - HOUR),
          email: null,
          guest: 1,
          id: 'rep-1',
          message: 'Wrong',
          name: null,
          resolution: null,
          resolvedAt: null,
          resolvedVersion: null,
          reviewAt: null,
          reviewNote: null,
          version: 1,
          videoId: ids[0],
        },
      ],
    },
    '/api/admin/settings': {
      autoPause: null,
      generationEnabled: true,
      limits: { site: 60, user: 5 },
    },
    '/api/admin/signals': {
      accounts: [
        {
          ...account(karaoke),
          client: MAC_CHROME,
          createdAt: ago(6 * DAY),
          flags: ['shared_network', 'refused'],
          refusals: 3,
          songs: 14,
        },
        {
          ...account(blocked),
          client: '',
          createdAt: ago(2 * DAY),
          flags: ['automated', 'new_at_limit'],
          refusals: 9,
          songs: 5,
        },
      ],
      networks: [
        {
          accounts: [account(karaoke), account(weekend)],
          automated: false,
          guestSongs: 2,
          key: 'a7f3',
          refusals: 3,
          songs: 19,
        },
        {
          accounts: [],
          automated: true,
          guestSongs: 6,
          key: '0c21',
          refusals: 11,
          songs: 6,
        },
      ],
    },
    '/api/admin/usage': {
      days: Array.from({ length: 14 }, (_, i) => {
        const wave = (i * 7) % 5
        return {
          active: 40 + wave * 6 - i,
          day: new Date(now - i * DAY).toISOString().slice(0, 10),
          generations: 6 + wave,
          generationsFailed: wave % 2,
          newAccounts: 1 + (wave % 3),
          reports: wave % 3 === 0 ? 1 : 0,
          signedIn: 12 + wave * 2,
          songOpens: 150 + wave * 23 - i * 3,
        }
      }),
      events: [
        { actors: 212, count: 1489, name: 'song_open' },
        { actors: 240, count: 702, name: 'app_open' },
        { actors: 61, count: 133, name: 'lyrics_feature' },
        { actors: 14, count: 17, name: 'share' },
        { actors: 9, count: 9, name: 'install_prompt' },
        { actors: 6, count: 6, name: 'installed' },
      ],
      plays: [
        { at: ago(2 * MINUTE), by: commute[1], guest: false, videoId: ids[0] },
        { at: ago(9 * MINUTE), by: 'Guest 3e9b', guest: true, videoId: ids[3] },
        { at: ago(31 * MINUTE), by: karaoke[1], guest: false, videoId: ids[1] },
        { at: ago(2 * HOUR), by: 'Guest 71d0', guest: true, videoId: ids[4] },
        { at: ago(5 * HOUR), by: learner[1], guest: false, videoId: ids[5] },
      ],
      songs: ids.map((videoId, i) => ({ listens: 96 - i * 11, videoId })),
      week: { active: 268, signedIn: 41 },
    },
    '/api/admin/users': {
      users: [
        user(admin, 'admin', 'default', 12 * MINUTE, [3, 0, 22]),
        user(commute, 'user', 'default', 2 * MINUTE, [188, 1, 9]),
        user(karaoke, 'user', 10, 31 * MINUTE, [342, 4, 41]),
        user(learner, 'user', 'default', 5 * HOUR, [57, 2, 6]),
        user(quiet, null, 'default', 3 * DAY, [12, 0, 1]),
        user(weekend, 'user', 'unlimited', 6 * DAY, [96, 0, 17]),
        user(blocked, 'user', 'default', 2 * DAY, [4, 0, 5], 1),
      ],
    },
  }
}

/**
 * Signed in as an admin, with the admin console answered in the page (adminConsole). Better Auth's own admin calls
 * (block, unblock) are answered too, so a press on them never reaches the Worker. A GET the console doesn't know
 * answers 404, which the page shows as "Needs the Worker update": a new tab needs its answer here
 */
export const adminSession = async (page: Page) => {
  await signIn(page, 'admin')
  const answers = adminConsole(Date.now())
  await page.route(
    /\/api\/(?:admin|auth\/admin)(?:\/|$|\?)/u,
    async (route) => {
      const request = route.request()
      if (request.method() !== 'GET') {
        await route.fulfill({ status: 204 })
        return
      }
      const body = answers[new URL(request.url()).pathname]
      await (body === undefined
        ? route.fulfill({ json: { error: 'not in the lab' }, status: 404 })
        : route.fulfill({ json: body }))
    }
  )
}

// A version's coverage: every line translated and read, timing and romaji as given
const coverage = (timed: number | null, romaji: number | null) => ({
  chinese: 1,
  english: 1,
  lines: 42,
  readings: 1,
  romaji,
  timed,
})

/**
 * An admin on a song's Lyrics Versions page (src/lib/synbox-flask/lyrics-versions.ts › listLyricsVersions): three
 * versions, the newest the default and complete, an auto-fix with gaps, and the original with no timing, so every
 * kind of row the page draws shows. The backend is never asked
 */
export const versionsSession = async (page: Page) => {
  await adminSession(page)
  const now = Date.now()
  const versions = [
    {
      created_at: new Date(now - 30 * DAY).toISOString(),
      note: 'the lyrics shown before this change',
      source: 'before versions',
      summary: coverage(null, 1),
      version: 1,
    },
    {
      created_at: new Date(now - 9 * DAY).toISOString(),
      note: 'text from lrclib; 38 of 42 lines verified',
      source: 'audit-fix',
      summary: coverage(0.95, 0.85),
      version: 2,
    },
    {
      created_at: new Date(now - 2 * HOUR).toISOString(),
      note: 'text from lrclib; 42 of 42 lines verified',
      source: 'lyrics-v2',
      summary: coverage(1, 1),
      version: 3,
    },
  ]
  await page.route(/\/lyrics\/[^/?]+\/versions(?:\?|$)/u, async (route) => {
    const videoId = /\/lyrics\/(?<id>[^/?]+)\//u.exec(route.request().url())
      ?.groups?.id
    await route.fulfill({
      json: { active: 3, versions, video_id: videoId ?? '' },
    })
  })
}
