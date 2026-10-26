import { Link } from 'react-router'

import { Ext, INLINE_LINK, LegalPage } from '@/components/shared/legal-page'
import type { LegalSection } from '@/components/shared/legal-page'

// What using Synbox commits a person to. Every promise here is one the code keeps: limits (worker/src/quota.ts),
// reports (worker/src/reports.ts), Google sign-in only. Change it when they change, and keep Privacy in step
const SECTIONS: LegalSection[] = [
  {
    items: [
      <>
        Using Synbox means accepting these Terms, the{' '}
        <Link to='/privacy' className={INLINE_LINK}>
          Privacy Policy
        </Link>{' '}
        and <Ext href='https://www.youtube.com/t/terms'>YouTube’s Terms</Ext>.
        Anyone who does not accept them may not use Synbox.
      </>,
      'You must be 13 or older and old enough to accept these Terms where you live, or have a parent or guardian accept them for you.',
    ],
    title: 'Agreement',
  },
  {
    items: [
      'Synbox is a free, non-commercial karaoke site for Japanese songs.',
      'Lyrics, readings, translations and timing are machine-generated and may contain errors.',
      'Videos play from YouTube and belong to their owners.',
      'Features, limits and the service itself may change or end at any time.',
    ],
    title: 'The Service',
  },
  {
    items: [
      'Sign-in is through Google. An account is for one person and may not be shared.',
      'We may limit, suspend or delete an account that breaks these Terms, with or without notice.',
    ],
    title: 'Accounts',
  },
  {
    items: [
      'Scraping, bulk copying or sending automated requests.',
      'Getting around limits, such as with extra accounts, by switching networks or by skipping sign-in.',
      'Overloading, attacking or probing the service, or using its APIs outside the app.',
      'Sending unlawful, abusive, hateful or sexual content, or spam, in reports or anywhere else.',
      'Using Synbox to infringe anyone’s rights, or republishing its lyrics, translations or timing.',
      'Impersonating anyone.',
    ],
    title: 'Not Allowed',
  },
  {
    items: [
      'You are responsible for the reports and notes you send.',
      'You grant us a free, worldwide licence to store, use and change them to run and improve Synbox.',
      'We may remove anything you send.',
    ],
    title: 'Content You Send',
  },
  {
    items: [
      'Songs, lyrics and translations belong to their rights holders. Synbox shows them for personal study and singing along.',
      'Rights holders can have a song removed by writing through Contact Me (below) or to me@edwardhuang.dev.',
      'We own the app’s design and code.',
    ],
    title: 'Songs and Lyrics',
  },
  {
    items: [
      'Synbox is provided as is, without any promise that it is accurate, available or free of errors, or that data will not be lost.',
      'As far as the law allows, we are not liable for indirect or consequential loss, and our total liability is limited to S$50.',
    ],
    title: 'Disclaimer and Liability',
  },
  {
    items: [
      'You may stop using Synbox at any time and ask us to delete your data.',
      'We may end or suspend access to Synbox, including for breaches of these Terms.',
      'Changes appear here with a new date. Using Synbox after a change means accepting it.',
      'These Terms are governed by Singapore law, and Singapore’s courts decide disputes.',
      'For questions, use Contact Me (below) or email me@edwardhuang.dev.',
    ],
    title: 'Ending, Changes and Law',
  },
]

const TermsPage = () => (
  <LegalPage title='Terms' updated='26 October 2026' sections={SECTIONS} />
)

export default TermsPage
