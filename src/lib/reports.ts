// A listener's report of something wrong with a song's lyrics, kept by the auth Worker (worker/src/reports.ts)
// for whoever fixes the lyrics pipeline

export const REPORT_MESSAGE_MAX = 1000

export interface ReportRequest {
  videoId: string
  // Where the song was when the report was opened
  atSeconds: number | null
  // The lyrics version on screen; null for the song's current lyrics
  version: number | null
  message: string
}

export type ReportResult = 'sent' | 'limit' | 'failed'

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
    return response.status === 429 ? 'limit' : 'failed'
  } catch {
    return 'failed'
  }
}
