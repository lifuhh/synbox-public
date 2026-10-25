import { Link } from 'react-router'

import { Ext, LegalPage } from '@/components/shared/legal-page'
import type { LegalSection } from '@/components/shared/legal-page'

const inline = 'underline underline-offset-2 hover:text-foreground'

// What using Synbox commits a person to. Every promise here is one the code keeps: limits (worker/src/quota.ts),
// reports (worker/src/reports.ts), Google sign-in only. Change it when they change, and keep Privacy in step
const SECTIONS: LegalSection[] = [
  {
    items: [
      <>
        Using Synbox means agreeing to these Terms, the{' '}
        <Link to='/privacy' className={inline}>
          Privacy Policy
        </Link>{' '}
        and <Ext href='https://www.youtube.com/t/terms'>YouTube’s Terms</Ext>.
        If you don’t agree, don’t use it.
      </>,
      'You must be 13 or older, and old enough where you live to agree, or have a parent or guardian agree for you.',
    ],
    title: 'The Deal',
  },
  {
    items: [
      'A free, non-commercial karaoke site for Japanese songs.',
      'Lyrics, readings, translations and timing are made by machines and can be wrong.',
      'Videos play from YouTube and belong to their owners.',
      'Features, limits and the service itself can change or stop at any time.',
    ],
    title: 'What Synbox Is',
  },
  {
    items: [
      'You sign in with Google. Keep your account to yourself.',
      'We can limit, suspend or delete an account that breaks these Terms, without notice.',
    ],
    title: 'Your Account',
  },
  {
    items: [
      'Scrape, copy in bulk or send automated requests.',
      'Get around limits: extra accounts, switching networks, or skipping sign-in.',
      'Overload, attack or probe the service, or use its APIs outside the app.',
      'Send anything unlawful, abusive, hateful, sexual, or spam in reports or anything else.',
      'Use Synbox to infringe anyone’s rights, or republish its lyrics, translations or timing.',
      'Pretend to be someone else.',
    ],
    title: 'Don’t',
  },
  {
    items: [
      'You’re responsible for the reports and notes you send.',
      'You let us store, use and change them, free and worldwide, to run and improve Synbox.',
      'We can remove anything you send.',
    ],
    title: 'What You Send',
  },
  {
    items: [
      'Songs, lyrics and translations belong to their rights holders. Synbox shows them for personal learning and singing along.',
      'Rights holders: message us on LinkedIn (below) and we’ll remove the song.',
      'The app’s design and code are ours.',
    ],
    title: 'Songs and Lyrics',
  },
  {
    items: [
      'Synbox is provided as is, with no promise that it’s accurate, available or error-free, or that your data won’t be lost.',
      'As far as the law allows, we aren’t liable for indirect or consequential loss, and our total liability is limited to S$50.',
    ],
    title: 'No Guarantees',
  },
  {
    items: [
      'You can stop using Synbox any time and ask us to delete your data.',
      'We can end or suspend access, most of all for breaking these Terms.',
      'Changes show here with a new date; using Synbox after them means agreeing.',
      'Singapore law applies, and Singapore’s courts decide disputes.',
      'Questions: message us on LinkedIn (below).',
    ],
    title: 'Ending, Changes and Law',
  },
]

const TermsPage = () => (
  <LegalPage title='Terms' updated='26 October 2026' sections={SECTIONS} />
)

export default TermsPage
