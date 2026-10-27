import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router'

// Their own chunks: loaded on the first press of Contact Me or Send Feedback
const ContactDialog = lazy(async () => await import('./contact-dialog'))
const FeedbackDialog = lazy(async () => await import('./feedback-dialog'))

// Kept here as well as in contact-dialog.tsx, so the footer doesn't load the form's chunk to show it
const CONTACT_EMAIL = 'me@edwardhuang.dev'

const LINK =
  'inline-flex min-h-6 items-center py-1 transition-colors hover:text-foreground'

// The footer of About, Privacy and Terms: the two policies, the two ways to write (Send Feedback about the app,
// Contact Me with the address it answers from), then the source. Plain links, no secondary lines: the dialogs say
// what each is for. Wraps on a phone, one line from sm
export const SiteLinks = () => {
  // Mounted from their first opening on, so they can animate closed
  const [contact, setContact] = useState<'closed' | 'open' | null>(null)
  const [feedback, setFeedback] = useState<'closed' | 'open' | null>(null)
  return (
    <>
      <nav
        aria-label='Links'
        className='mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-x-5 gap-y-1 pt-8 text-sm text-muted-foreground'>
        <Link to='/privacy' className={LINK}>
          Privacy
        </Link>
        <Link to='/terms' className={LINK}>
          Terms
        </Link>
        <button
          type='button'
          className={LINK}
          onClick={() => {
            setFeedback('open')
          }}>
          Send Feedback
        </button>
        <button
          type='button'
          className={LINK}
          onClick={() => {
            setContact('open')
          }}>
          Contact Me
        </button>
        <a href={`mailto:${CONTACT_EMAIL}`} className={LINK}>
          {CONTACT_EMAIL}
        </a>
        <a
          href='https://github.com/lifuhh/synbox-public'
          target='_blank'
          rel='noreferrer'
          className={LINK}>
          GitHub
        </a>
      </nav>
      {feedback !== null && (
        <Suspense>
          <FeedbackDialog
            open={feedback === 'open'}
            onOpenChange={(open) => {
              setFeedback(open ? 'open' : 'closed')
            }}
          />
        </Suspense>
      )}
      {contact !== null && (
        <Suspense>
          <ContactDialog
            open={contact === 'open'}
            onOpenChange={(open) => {
              setContact(open ? 'open' : 'closed')
            }}
          />
        </Suspense>
      )}
    </>
  )
}
