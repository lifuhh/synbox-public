// The Contact form's message, from a signed-in account: kept and emailed to the owner by the auth Worker
// (worker/src/contact.ts), which answers it at the account's own email

export const SUBJECT_MAX = 120
export const MESSAGE_MAX = 4000

export interface ContactRequest {
  subject: string
  message: string
  // The hidden field only bots fill in
  website: string
}

export type ContactResult =
  | 'sent'
  | 'limit'
  | 'invalid'
  | 'signed_out'
  | 'failed'

export const sendContact = async (
  request: ContactRequest
): Promise<ContactResult> => {
  try {
    const response = await fetch('/api/contact', {
      body: JSON.stringify(request),
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
    if (response.status === 401) {
      return 'signed_out'
    }
    return response.status === 400 ? 'invalid' : 'failed'
  } catch {
    return 'failed'
  }
}
