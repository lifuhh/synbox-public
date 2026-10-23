import { expect, test } from 'vite-plus/test'

import { versionLiveAt } from './admin-console'
import { unseenFixCount, withPending } from './report-fixes'

const fix = (videoId: string, seen = false) => ({
  fixedAt: 1,
  seen,
  videoId,
})

test('a fix marked on this device stays marked while the Worker catches up', () => {
  const fixes = [fix('a'), fix('b'), fix('c', true)]
  const pending = new Map([
    ['a', 'dismiss'],
    ['b', 'seen'],
  ] as const)
  const shown = withPending(fixes, pending)
  expect(shown.map((one) => one.videoId)).toEqual(['b', 'c'])
  expect(unseenFixCount(shown)).toBe(0)
  expect(unseenFixCount(withPending(fixes, new Map()))).toBe(2)
})

test('the version a listener reported is the newest saved by then, not the live one', () => {
  const versions = [
    { created_at: '2026-10-01T00:00:00+00:00', version: 0 },
    { created_at: '2026-10-10T00:00:00+00:00', version: 1 },
    { created_at: '2026-10-20T00:00:00+00:00', version: 2 },
  ]
  expect(versionLiveAt(versions, Date.parse('2026-10-15T00:00:00Z'))).toBe(1)
  expect(versionLiveAt(versions, Date.parse('2026-10-10T00:00:00Z'))).toBe(1)
  // Reported before any version was saved: whatever is live now is newer
  expect(versionLiveAt(versions, Date.parse('2026-09-01T00:00:00Z'))).toBe(null)
})
