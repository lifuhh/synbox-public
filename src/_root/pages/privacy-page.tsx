import { Link } from 'react-router'

import { Ext, INLINE_LINK, LegalPage } from '@/components/shared/legal-page'
import type { LegalSection } from '@/components/shared/legal-page'

// What the code keeps about a person and why: the Worker's D1 tables (worker/migrations), Google sign-in
// (worker/src/auth.ts, scopes openid, email and profile only), YouTube (src/lib/youtube) and Sentry
// (src/instrument.ts). Change it when they change
const SECTIONS: LegalSection[] = [
  {
    items: [
      'Your Google name, email, profile picture and account id, from Google sign-in. Nothing else from your Google account.',
      'Your signed-in sessions, with the browser and IP address they came from.',
      'Songs you generated and checked, and when, with a one-way code made from your network and your browser name, for the limits.',
      'Your history, saved songs, likes, playlists and settings, so they follow you to other devices.',
      'Lyrics reports you send.',
      'Songs you played in the last hour, by account or by a random id in your browser, so a reload isn’t counted twice. Signed in, every visit to a song counts; as a guest, once per song an hour.',
      'With an account: how many songs you’ve played, when you last played one, and when you last used the app (to within 10 minutes).',
      'Without an account: a one-way code made from your network counts your free song.',
    ],
    title: 'What We Store',
  },
  {
    items: [
      'To see which parts of Synbox get used, the app records a few events: the app opened (installed or in a browser; phone, tablet or computer), a song page opened (the song’s id), lyrics, romaji or translation turned on or off, the translation language, a song shared or its link copied, and Install App pressed or the app installed.',
      'Each carries its time and your account, or without one, a random id kept in your browser. No IP address, email or browser details.',
      'Kept 90 days, then deleted. Only the admin sees them.',
      'If your browser sends Global Privacy Control or Do Not Track, none are sent.',
    ],
    title: 'Usage Events',
  },
  {
    items: [
      'To sign you in and sync your library.',
      'To keep limits fair: every new song costs money to make.',
      'To fix the lyrics you report and the errors the app hits.',
      'To run and improve Synbox, and to set limits against abuse.',
      'No ads, and nothing is sold.',
    ],
    title: 'Why',
  },
  {
    items: [
      'Accounts, libraries and usage events: Cloudflare.',
      'Lyrics are made on Google Cloud, which gets your account id only, not your name or email.',
      'Songs and lyrics: Appwrite. No personal data.',
      'Making lyrics sends the song’s audio and text, not your data, to OpenAI and ElevenLabs.',
      'Error reports: Sentry, with a short screen recording around the error; all text and media are hidden in it.',
      'The site is served by Netlify.',
      'This data may be processed outside your country.',
      "The site's admin sees accounts, their activity and who generated which song, to manage limits and stop abuse.",
    ],
    title: 'Where It Lives',
  },
  {
    items: [
      'Synbox uses YouTube API Services for song details and plays videos in YouTube’s player.',
      <>
        By using Synbox you agree to{' '}
        <Ext href='https://www.youtube.com/t/terms'>YouTube’s Terms</Ext>.
        YouTube and Google handle their own data under the{' '}
        <Ext href='https://policies.google.com/privacy'>
          Google Privacy Policy
        </Ext>
        .
      </>,
      'The player uses YouTube’s privacy-enhanced mode.',
    ],
    title: 'YouTube',
  },
  {
    items: [
      'A sign-in cookie keeps you signed in.',
      'Your browser keeps your settings and offline lyrics. Clearing site data removes them.',
      'No advertising cookies, and no third-party analytics.',
    ],
    title: 'Cookies and Storage',
  },
  {
    items: [
      'Plays and song checks: up to a day.',
      'Usage events: 90 days.',
      'Your account, its activity, library, reports and the songs you generated: until you delete them or ask us to.',
      'Sign-in sessions: until you sign out or they expire.',
      'Error reports: Sentry keeps them for a limited time.',
    ],
    title: 'How Long',
  },
  {
    items: [
      'Everything in the library plays without signing in.',
      'Sign out from the profile menu any time.',
      <>
        Remove Synbox’s access to your Google account in{' '}
        <Ext href='https://myaccount.google.com/permissions'>
          Google’s security settings
        </Ext>
        .
      </>,
      'To see, correct or delete your data, or to ask anything about it, message us on LinkedIn (below). Deleting removes your account and everything tied to it. We aim to reply within 30 days.',
    ],
    title: 'Your Choices',
  },
  {
    items: [
      'Synbox isn’t meant for children under 13, and we don’t knowingly keep their data. Tell us and we’ll delete it.',
      <>
        Changes show here with a new date. Using Synbox also means agreeing to
        the{' '}
        <Link to='/terms' className={INLINE_LINK}>
          Terms
        </Link>
        .
      </>,
    ],
    title: 'Also',
  },
]

const PrivacyPage = () => (
  <LegalPage title='Privacy' updated='26 October 2026' sections={SECTIONS} />
)

export default PrivacyPage
