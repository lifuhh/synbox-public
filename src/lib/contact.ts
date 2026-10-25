import { deviceId } from './song-stats'

// The Contact form's message, kept and emailed to the owner by the auth Worker (worker/src/contact.ts)

export const SUBJECT_MAX = 120
export const MESSAGE_MAX = 4000

export interface ContactRequest {
  subject: string
  message: string
  // Where to reply; empty for none
  replyTo: string
  // The hidden field only bots fill in
  website: string
}

export type ContactResult = 'sent' | 'limit' | 'invalid' | 'failed'

export const sendContact = async (
  request: ContactRequest
): Promise<ContactResult> => {
  try {
    const response = await fetch('/api/contact', {
      body: JSON.stringify({ ...request, device: deviceId() }),
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    if (response.ok) {
      return 'sent'
    }
    if (response.status === 429) {
      return 'limit'
    }
    return response.status === 400 ? 'invalid' : 'failed'
  } catch {
    return 'failed'
  }
}
