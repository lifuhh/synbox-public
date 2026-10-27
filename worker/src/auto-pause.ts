// The owner's email when the site's daily ceiling pauses new songs (quota.ts › tripIfFull), sent once per pause by
// the request that flipped the switch, through the Contact form's binding and addresses (contact.ts). It never
// throws: a failed email is logged, and the pause and the refusal stand

import type { ContactEnv } from './contact'
import type { SiteTrip } from './quota'

const clock = (at: number) => new Date(at).toISOString().slice(11, 16)

export const autoPauseEmail = (trip: SiteTrip, adminUrl: string) => ({
  subject: `Synbox paused new songs: ${trip.count} today hit the daily ceiling`,
  text: `New songs paused automatically at ${clock(trip.at)} UTC after ${trip.count} generations today. Users see "New Songs Paused". Resume on the admin page: ${adminUrl}`,
})

export const emailAutoPause = async (
  env: ContactEnv,
  trip: SiteTrip,
  adminUrl: string
) => {
  const { EMAIL: email, CONTACT_TO: to = '', CONTACT_FROM: from = '' } = env
  if (email === undefined || to === '' || from === '') {
    console.error('auto-pause email not sent: not_configured')
    return
  }
  try {
    await email.send({
      from: { email: from, name: 'Synbox' },
      to,
      ...autoPauseEmail(trip, adminUrl),
    })
  } catch (error) {
    console.error(
      'auto-pause email not sent:',
      error instanceof Error ? error.message.slice(0, 200) : 'send_failed'
    )
  }
}
