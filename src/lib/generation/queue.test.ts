import { expect, test } from 'vite-plus/test'

import type { Job, JobStatus } from './queue'
import { applyCommand, decodeJobs, encodeJobs } from './queue'

const HOUR = 60 * 60_000
const NOW = 100 * HOUR

const job = (
  id: string,
  videoId: string,
  status: JobStatus,
  seen = false
): Job => ({
  ahead: 0,
  id,
  mode: 'new',
  reconnectingSince: null,
  requestId: `r-${id}`,
  runs: {},
  seen,
  skipUploaderLyrics: false,
  startedAt: 0,
  status,
  title: '',
  video: null,
  videoId,
})

const done = (hoursAgo: number): JobStatus => ({
  at: NOW - hoursAgo * HOUR,
  karaoke: null,
  kind: 'complete',
  outcome: { kind: 'created' },
})

test('a stored queue keeps every song in progress and only fresh finished ones', () => {
  const jobs = [
    job('a', 'v1', { kind: 'running', phase: 'transcribe' }),
    job('b', 'v2', { kind: 'waiting' }),
    // Unseen: kept for a day; seen: for an hour
    job('c', 'v3', done(20)),
    job('d', 'v4', done(30)),
    job('e', 'v5', done(0.5), true),
    job('f', 'v6', done(2), true),
  ]
  expect(decodeJobs(encodeJobs(jobs), NOW).map(({ id }) => id)).toEqual([
    'a',
    'b',
    'c',
    'e',
  ])

  // Another build's or a broken copy reads as an empty queue, and a bad entry is left out
  expect(decodeJobs('{"v":2,"jobs":[]}', NOW)).toEqual([])
  expect(decodeJobs('not json', NOW)).toEqual([])
  const unknownPhase = {
    ...jobs[0],
    id: 'g',
    status: { kind: 'running', phase: 'sing' },
  }
  expect(
    decodeJobs(JSON.stringify({ jobs: [...jobs, unknownPhase], v: 1 }), NOW)
  ).toHaveLength(4)
})

test('a song added from two tabs at once runs once, behind the songs already in line', () => {
  const line = [
    job('a', 'v1', { kind: 'running', phase: 'validate' }),
    job('b', 'v2', { kind: 'waiting' }),
  ]
  const fromB = job('x', 'v3', { kind: 'waiting' })
  const fromC = job('y', 'v3', { kind: 'waiting' })
  let jobs = applyCommand(line, { job: fromB, replaces: null, type: 'add' })
  jobs = applyCommand(jobs, { job: fromC, replaces: null, type: 'add' })
  // The same command applied again by a tab that took over
  jobs = applyCommand(jobs, { job: fromB, replaces: null, type: 'add' })
  expect(jobs.map(({ id }) => id)).toEqual(['a', 'b', 'x'])

  // A retry takes its failed job's place at the back of the line, and a finished run of the song gives way
  const failed = job('f', 'v4', {
    at: NOW,
    code: undefined,
    kind: 'failed',
    message: 'x',
    retry: true,
  })
  const retry = job('g', 'v4', { kind: 'waiting' })
  jobs = applyCommand([failed, ...jobs], {
    job: retry,
    replaces: 'f',
    type: 'add',
  })
  expect(jobs.map(({ id }) => id)).toEqual(['a', 'b', 'x', 'g'])
})

test('Dismiss All clears finished and failed songs and keeps the ones still going', () => {
  const failed: JobStatus = {
    at: NOW,
    code: undefined,
    kind: 'failed',
    message: 'x',
    retry: true,
  }
  const jobs = [
    job('a', 'v1', done(1)),
    job('b', 'v2', { kind: 'running', phase: 'transcribe' }),
    job('c', 'v3', failed),
    job('d', 'v4', { kind: 'waiting' }),
  ]
  const kept = applyCommand(jobs, { type: 'dismiss-all' })
  expect(kept.map(({ id }) => id)).toEqual(['b', 'd'])
  // Nothing left to clear: the same list back, so no tab saves or re-renders for it
  expect(applyCommand(kept, { type: 'dismiss-all' })).toBe(kept)
})
