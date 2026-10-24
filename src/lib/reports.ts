// A signed-in listener's report of something wrong with a song's lyrics, kept by the auth Worker
// (worker/src/reports.ts) for whoever fixes the lyrics pipeline

export const REPORT_MESSAGE_MAX = 1000

export interface ReportRequest {
  videoId: string
  // Where the song was when the report was opened
  atSeconds: number | null
  // The lyrics version on screen, so a fix can tell the reporter their song changed; null when unknown
  version: number | null
  message: string
}

// uninformative: the Worker found nothing to act on in the message; signedOut: the session ended meanwhile;
// alreadyReported: the account's report on the song is still open (one open report per song)
export type ReportResult =
  | 'sent'
  | 'limit'
  | 'uninformative'
  | 'signedOut'
  | 'alreadyReported'
  | 'failed'

// The account's open report on a song, which the form shows instead of itself
export interface OpenReport {
  message: string
  createdAt: number
}

export const fetchMyReport = async (
  videoId: string
): Promise<OpenReport | null> => {
  const response = await fetch(
    `/api/reports/mine?videoId=${encodeURIComponent(videoId)}`,
    { credentials: 'same-origin' }
  )
  if (!response.ok) {
    throw new Error(`reports/mine ${response.status}`)
  }
  const body: unknown = await response.json()
  const report =
    typeof body === 'object' && body !== null && 'report' in body
      ? body.report
      : null
  return typeof report === 'object' &&
    report !== null &&
    'message' in report &&
    typeof report.message === 'string' &&
    'createdAt' in report &&
    typeof report.createdAt === 'number'
    ? { createdAt: report.createdAt, message: report.message }
    : null
}

const codeOf = async (response: Response) => {
  try {
    const body: unknown = await response.json()
    return typeof body === 'object' && body !== null && 'code' in body
      ? body.code
      : null
  } catch {
    return null
  }
}

export const sendReport = async (
  report: ReportRequest
): Promise<ReportResult> => {
  try {
    const response = await fetch('/api/reports', {
      body: JSON.stringify({
        ...report,
        build: __BUILD_ID__ === 'local' ? null : __BUILD_ID__,
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    if (response.ok) {
      return 'sent'
    }
    if (response.status === 429) {
      return 'limit'
    }
    if (response.status === 401) {
      return 'signedOut'
    }
    if (response.status === 409) {
      return 'alreadyReported'
    }
    return (await codeOf(response)) === 'uninformative'
      ? 'uninformative'
      : 'failed'
  } catch {
    return 'failed'
  }
}

// The live lyrics version a song's lyrics row says it holds (the backend's `active_version`, set whenever a version
// goes live); null for a row from before versions, or no row
export const liveVersionOf = (row: unknown): number | null => {
  const value =
    typeof row === 'object' && row !== null && 'active_version' in row
      ? row.active_version
      : null
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null
}
