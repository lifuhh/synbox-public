import { Link } from 'react-router'

import { Ext, INLINE_LINK, LegalPage } from '@/components/shared/legal-page'
import type { LegalSection } from '@/components/shared/legal-page'

// What the code keeps about a person and why: the Worker's D1 tables (worker/migrations), Google sign-in
// (worker/src/auth.ts, scopes openid, email and profile only), YouTube (src/lib/youtube) and Sentry
// (src/instrument.ts). Change it when they change
const SECTIONS: LegalSection[] = [
  {
    items: [
      'Your name, email and profile picture from Google sign-in. Nothing else from your Google account.',
      'Your library: history, saved songs, likes, playlists and settings, so they follow you to other devices.',
      'Songs you generate, and the lyrics reports, messages and feedback you send us. Anonymous feedback keeps nothing about you.',
      'Basic usage, such as songs played and features used, to see what works.',
      'Basic network and device details, such as your IP address and browser, to keep you signed in, count song limits and stop abuse.',
    ],
    title: 'What We Store',
  },
  {
    items: [
      'To sign you in and sync your library.',
      'To apply song limits, since every new song costs money to make.',
      'To fix reported lyrics and app errors, and to improve Synbox.',
      'No advertising, and no data is sold.',
      'Usage is not recorded if your browser sends Global Privacy Control or Do Not Track.',
    ],
    title: 'Why It Is Kept',
  },
  {
    items: [
      'Accounts and libraries: Cloudflare. Songs and lyrics: Appwrite. The site: Netlify.',
      'Lyrics are made on Google Cloud, which gets your account id only. Making them sends the song’s audio and text, never your data, to AI services (OpenAI, ElevenLabs).',
      'Error reports: Sentry, with a short screen recording that hides all text and media.',
      'This data may be processed outside your country. The admin sees accounts and their activity, to manage limits and stop abuse.',
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
      'Song checks and feedback limits: a day. Usage: 90 days.',
      'Your account, everything in it and the details kept with it: until you delete it or ask us to. A guest’s free song is kept so it counts once.',
      'Sign-in: until you sign out or it expires. Error reports: a limited time.',
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
      'To see, correct or delete your data, or to ask anything about it, use Contact Me (below) or email me@edwardhuang.dev. Deleting removes your account and everything tied to it. We aim to reply within 30 days.',
    ],
    title: 'Your Choices',
  },
  {
    items: [
      'Synbox is not intended for children under 13, and we do not knowingly keep their data. If a child’s data reaches us, tell us and it will be deleted.',
      <>
        Changes appear here with a new date. Using Synbox also means accepting
        the{' '}
        <Link to='/terms' className={INLINE_LINK}>
          Terms
        </Link>
        .
      </>,
    ],
    title: 'Children and Changes',
  },
]

const PrivacyPage = () => (
  <LegalPage title='Privacy' updated='27 October 2026' sections={SECTIONS} />
)

export default PrivacyPage
