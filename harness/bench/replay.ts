// Recorded backend answers, in the main checkout's .harness/bench/fixtures/ and named by a hash of the request. The
// bench server replays them, and so does every browser the harness opens (engines/browser.ts › open) and the local
// site (local-site.ts), so an automated run reads the lookup service's data without waking it: the service scales
// to zero and is billed while an instance is up. SYNBOX_LIVE_LOOKUP=1 sends the browsers and the local site to the
// live services instead. The release smoke test on a deployed copy (smoke.ts <url>) always reads them live.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { isRecord, parseJson } from './json'

export interface Fixture {
  request: { method: string; url: string }
  status: number
  contentType: string
  body: string
  recordedAt: string
}

const isFixture = (v: unknown): v is Fixture =>
  isRecord(v) &&
  typeof v.body === 'string' &&
  typeof v.contentType === 'string' &&
  typeof v.status === 'number'

export const fixtureFile = (dir: string, method: string, url: string): string =>
  path.join(
    dir,
    `${createHash('sha256').update(`${method} ${url}`).digest('hex').slice(0, 20)}.json`
  )

/** Whether this run asked for the live lookup service on purpose */
export const liveLookup = (): boolean => process.env.SYNBOX_LIVE_LOOKUP === '1'

/** The two services the site calls directly, as netlify.toml gives them to the build */
export const backendOrigins = (
  repoTop: string
): { lookup: string; api: string } => {
  const toml = readFileSync(path.join(repoTop, 'netlify.toml'), 'utf-8')
  const lookup = /VITE_SYNBOX_LOOKUP_URL\s*=\s*"(?<url>[^"]+)"/u.exec(toml)
    ?.groups?.url
  if (lookup === undefined) {
    throw new Error(
      'netlify.toml has no VITE_SYNBOX_LOOKUP_URL; the bench build needs it'
    )
  }
  // Trees from before the site read lyrics through the Worker don't set it
  const api =
    /VITE_SYNBOX_API_URL\s*=\s*"(?<url>[^"]+)"/u.exec(toml)?.groups?.url ??
    'https://api.synbox.io'
  return { api, lookup }
}

/** Bench servers running in this process; their own /api reads are replayed by the server, not the browser */
export const benchOrigins = new Set<string>()

export type Answered = 'replayed' | 'recorded' | 'live'

/**
 * A GET answered from the fixtures: replayed when recorded, else asked live and recorded when it succeeds. Only a
 * success is kept: a 404 recorded while a route was not live yet (the Worker's /api/recommendations, 2026-10-22)
 * replayed for good and failed every home probe. An error passes through and is asked again next run.
 * `notFoundIsData`: a JSON 404 is kept too ("Song is not in the library", the Worker's `not_found`), since asked
 * live it woke the lookup service on every run; a route that doesn't exist answers in plain text or HTML, or, on the
 * lookup service, "Not served here", and stays unrecorded
 */
export const replayedGet = async (
  dir: string,
  url: string,
  accept: string | null,
  notFoundIsData = false
): Promise<{
  answer: Omit<Fixture, 'request' | 'recordedAt'>
  how: Answered
}> => {
  const file = fixtureFile(dir, 'GET', url)
  if (existsSync(file)) {
    return {
      answer: parseJson(readFileSync(file, 'utf-8'), isFixture, file),
      how: 'replayed',
    }
  }
  const res = await fetch(url, {
    // The YouTube function passes the page's referrer on to Google; give it the production one
    headers: { accept: accept ?? '*/*', referer: 'https://synbox.io/' },
  })
  const answer = {
    body: await res.text(),
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    status: res.status,
  }
  const dataNotFound =
    notFoundIsData &&
    res.status === 404 &&
    answer.contentType.startsWith('application/json') &&
    !answer.body.includes('Not served here')
  if (!res.ok && !dataNotFound) {
    return { answer, how: 'live' }
  }
  const fixture: Fixture = {
    ...answer,
    recordedAt: new Date().toISOString(),
    request: { method: 'GET', url },
  }
  writeFileSync(file, JSON.stringify(fixture))
  return { answer, how: 'recorded' }
}
