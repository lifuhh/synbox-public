import { beforeEach, expect, test, vi } from 'vite-plus/test'

import {
  cancelGeneration,
  getGenerationState,
  MAX_RUNNING,
  startGeneration,
} from './store'

// Every request hangs until it is aborted, so started jobs stay running
beforeEach(() => {
  vi.stubGlobal('document', {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    visibilityState: 'visible',
  })
  vi.stubGlobal(
    'fetch',
    async (_url: string, init: RequestInit) =>
      await new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
  )
})

const kinds = () => getGenerationState().jobs.map((job) => job.status.kind)

test('songs past the running limit wait, and start when a slot frees', () => {
  for (const video of ['a', 'b', 'c', 'd']) {
    startGeneration({ mode: 'new', videoId: video.repeat(11) })
  }
  expect(MAX_RUNNING).toBe(3)
  expect(kinds()).toEqual(['running', 'running', 'running', 'waiting'])

  // The same song again opens the one already going instead of adding it twice
  expect(startGeneration({ mode: 'new', videoId: 'b'.repeat(11) })).toBe(false)
  expect(getGenerationState().jobs).toHaveLength(4)

  const { focusedId, jobs } = getGenerationState()
  expect(focusedId).toBe(jobs[1].id)

  // Cancelling the song on screen frees its slot for the waiting one and shows the newest song still going
  cancelGeneration(jobs[1].id)
  expect(kinds()).toEqual(['running', 'running', 'running'])
  expect(getGenerationState().focusedId).toBe(jobs[3].id)
})
