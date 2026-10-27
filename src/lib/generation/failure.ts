// How a generation request can fail, and which failures are worth asking again.

interface ErrorKind {
  // Asking again may work. The rest (the backend's own `error` message, a refused request) would fail the
  // same way, or pay twice
  retryable?: boolean
  // The connection went (dropped, went quiet, turned away at the door, or never came back from the
  // background) while the backend's job may still be running: asking again with the same request id
  // attaches to it
  lost?: boolean
  // Lost because the page just came back, so reconnect at once
  resumed?: boolean
  // The backend ended a long stream on purpose ({"type": "resume"}) while its job runs on, and asks to be
  // asked again: not a failure, and not a reconnect
  handoff?: boolean
  // Why the backend refused, when it says: sign_in_required, quota_exceeded, already_finished, ...
  code?: string
}

export class GenerationError extends Error {
  readonly retryable: boolean
  readonly lost: boolean
  readonly resumed: boolean
  readonly handoff: boolean
  readonly code: string | undefined

  constructor(message: string, kind: ErrorKind = {}) {
    super(message)
    this.name = 'GenerationError'
    this.lost = kind.lost === true || kind.resumed === true
    this.handoff = kind.handoff === true
    this.retryable = kind.retryable === true || this.lost || this.handoff
    this.resumed = kind.resumed === true
    this.code = kind.code
  }
}

// Our backend's own error line, {"type": "error", "data": "..."}, when the body is one
const backendMessage = (body: string): string | null => {
  for (const line of body.split('\n')) {
    try {
      const content: unknown = JSON.parse(line)
      if (
        typeof content === 'object' &&
        content !== null &&
        'type' in content &&
        content.type === 'error' &&
        'data' in content
      ) {
        return String(content.data)
      }
    } catch {
      // Not ours
    }
  }
  return null
}

// A response that is not 200. Cloud Run's front end turns requests away with 429 "Rate exceeded." (no
// instance free while songs use the CPU) or 502-504 before they reach the backend, which keeps its jobs
// running: those are a busy door, not a refusal. Only our backend's own words are final
export const failedResponse = (status: number, body: string) => {
  const ours = backendMessage(body)
  if (ours !== null) {
    return new GenerationError(ours)
  }
  if (status === 429) {
    return new GenerationError(
      'The lyrics server is busy. Try again in a minute',
      { lost: true }
    )
  }
  if (status === 502 || status === 503 || status === 504) {
    return new GenerationError(
      "Couldn't reach the lyrics server. Try again in a minute",
      { lost: true }
    )
  }
  return new GenerationError(`The lyrics server answered ${status}`, {
    retryable: status >= 500,
  })
}
