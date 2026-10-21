import { describe, expect, test } from 'vite-plus/test'

import { failedResponse } from './failure'

describe('a response that is not 200', () => {
  test('Cloud Run turning a reconnect away while songs use the CPU is a busy door: the job runs on', () => {
    // Seen in the production stress run: 429, body "Rate exceeded.", no instance free
    const busy = failedResponse(429, 'Rate exceeded.')
    expect(busy.lost).toBe(true)
    expect(failedResponse(503, 'Service Unavailable').lost).toBe(true)
  })

  test("our backend's own refusal stays final, whatever the status", () => {
    const ours = failedResponse(
      429,
      '{"type": "error", "data": "Too many requests, please try again later"}\n'
    )
    expect(ours).toMatchObject({
      lost: false,
      message: 'Too many requests, please try again later',
      retryable: false,
    })
  })

  test('anything else keeps its old meaning', () => {
    expect(failedResponse(404, 'Not Found')).toMatchObject({
      lost: false,
      retryable: false,
    })
    expect(failedResponse(500, '<html>')).toMatchObject({
      lost: false,
      retryable: true,
    })
  })
})
