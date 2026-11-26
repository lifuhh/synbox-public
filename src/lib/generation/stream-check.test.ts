// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vite-plus/test'

import { checkGeneration, UNREACHABLE } from './stream'

vi.mock(import('@/lib/auth'), () => ({
  backendToken: async () => await Promise.resolve(null),
}))

const goAhead = () => Response.json({ ok: true })

afterEach(() => {
  vi.unstubAllGlobals()
})

// 2026-11-26: a phone switched away from the app while the backend started. The backend answered at 31 s, the
// page's request died with its connection, and the listener read "Couldn't reach Synbox" for a backend that was up
test('a check whose connection died is asked once more', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('Load failed'))
    .mockResolvedValueOnce(goAhead())
  vi.stubGlobal('fetch', fetchMock)

  await expect(checkGeneration('dQw4w9WgXcQ', 'regenerate')).resolves.toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test('a check that waited its whole limit is not asked again', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
  vi.stubGlobal('fetch', fetchMock)

  await expect(checkGeneration('dQw4w9WgXcQ', 'regenerate')).resolves.toBe(
    UNREACHABLE
  )
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('a check still open when the page comes back is cut and asked again', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    // Never answers by itself: only its signal ends it
    .mockImplementationOnce(
      async (_input, init) =>
        // oxlint-disable-next-line promise/avoid-new -- a request that hangs until it is aborted
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
    )
    .mockResolvedValueOnce(goAhead())
  vi.stubGlobal('fetch', fetchMock)

  const answer = checkGeneration('dQw4w9WgXcQ', 'regenerate')
  await vi.waitFor(() => {
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  // The app was switched away, then shown again
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'hidden',
  })
  document.dispatchEvent(new Event('visibilitychange'))
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  })
  document.dispatchEvent(new Event('visibilitychange'))

  await expect(answer).resolves.toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
