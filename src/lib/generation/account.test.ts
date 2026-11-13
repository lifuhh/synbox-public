import { expect, test } from 'vite-plus/test'

import type { AccountRow } from './account'
import { mergeAccount } from './account'
import { overallValue } from './progress'
import type { Job } from './queue'

const NOW = 1_000_000

const row = (patch: Partial<AccountRow> = {}): AccountRow => ({
  createdAt: NOW - 60_000,
  errorCode: null,
  finishedAt: null,
  fraction: null,
  id: 'r1',
  kind: 'new',
  stage: null,
  status: 'running',
  videoId: 'v1',
  ...patch,
})

const job = (patch: Partial<Job> = {}): Job => ({
  ahead: 0,
  id: 'j1',
  mode: 'new',
  reconnectingSince: null,
  requestId: 'r1',
  runs: {},
  seen: false,
  skipUploaderLyrics: false,
  startedAt: NOW - 60_000,
  status: { kind: 'running', phase: 'transcribe' },
  title: '',
  video: null,
  videoId: 'v1',
  ...patch,
})

test('a song going on another device joins the list at its stage, its earlier steps done', () => {
  const [joined] = mergeAccount(
    [],
    [row({ fraction: 0.5, stage: 'align' })],
    NOW
  )
  expect(joined.mirror).toBe(true)
  expect(joined.status).toEqual({ kind: 'running', phase: 'transcribe' })
  expect(joined.runs.separate?.doneAt).toBe(NOW)
  // Past every stage before Syncing Words, by the panel's own weights
  expect(overallValue(joined.runs, NOW, false)).toBeGreaterThan(0.25)
})

test('a song streamed here keeps its own progress', () => {
  const here = job()
  const jobs = [here]
  expect(
    mergeAccount(jobs, [row({ fraction: 0.9, stage: 'verify' })], NOW)
  ).toBe(jobs)
})

test('one song going, asked for on two devices, is listed once', () => {
  const here = job({ requestId: 'mine' })
  expect(mergeAccount([here], [row({ id: 'theirs' })], NOW)).toEqual([here])
})

test('a mirrored song ends as the ledger says, and a dismissed one never comes back', () => {
  const [done] = mergeAccount(
    [job({ mirror: true })],
    [row({ finishedAt: NOW, status: 'succeeded' })],
    NOW
  )
  expect(done.status.kind).toBe('complete')
  expect(
    mergeAccount([], [row({ finishedAt: NOW, status: 'succeeded' })], NOW)
  ).toEqual([])
})

test('a mirrored song the account no longer lists leaves while going, stays once finished', () => {
  const finished = job({
    id: 'j2',
    mirror: true,
    requestId: 'r2',
    status: {
      at: NOW,
      code: undefined,
      kind: 'failed',
      message: 'x',
      retry: true,
    },
  })
  expect(mergeAccount([job({ mirror: true }), finished], [], NOW)).toEqual([
    finished,
  ])
})

test('a song this browser lost touch with takes the ledger’s word', () => {
  const lost = job({
    status: {
      at: NOW,
      code: 'connection_lost',
      kind: 'failed',
      message: 'Lost the connection',
      retry: true,
    },
  })
  const [saved] = mergeAccount(
    [lost],
    [row({ finishedAt: NOW, status: 'succeeded' })],
    NOW
  )
  expect(saved.status.kind).toBe('complete')
  const [going] = mergeAccount([lost], [row({ stage: 'translate' })], NOW)
  expect(going.status).toEqual({ kind: 'running', phase: 'translate' })
})
