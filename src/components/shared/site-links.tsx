import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router'

// Its own chunk: loaded on the first press of Contact
const ContactDialog = lazy(async () => await import('./contact-dialog'))

// Kept here as well as in contact-dialog.tsx, so the footer doesn't load the form's chunk to show it
const CONTACT_EMAIL = 'me@edwardhuang.dev'

const LINK =
  'inline-flex min-h-6 items-center py-1 transition-colors hover:text-foreground'

// The footer of About, Privacy and Terms: who made it, the two policies, and how to write. Wraps on a phone, one
// line from sm
export const SiteLinks = () => {
  // Mounted from its first opening on, so it can animate closed
  const [contact, setContact] = useState<'closed' | 'open' | null>(null)
  return (
    <>
      <nav
        aria-label='Links'
        className='mx-auto flex max-w-md flex-wrap items-center justify-center gap-x-5 gap-y-1 pt-10 text-sm text-muted-foreground'>
        <button
          type='button'
          className={LINK}
          onClick={() => {
            setContact('open')
          }}>
          Contact
        </button>
        <a href={`mailto:${CONTACT_EMAIL}`} className={LINK}>
          {CONTACT_EMAIL}
        </a>
        <Link to='/privacy' className={LINK}>
          Privacy
        </Link>
        <Link to='/terms' className={LINK}>
          Terms
        </Link>
        <a
          href='https://www.linkedin.com/in/lifuhh/'
          target='_blank'
          rel='noreferrer'
          className={LINK}>
          LinkedIn
        </a>
      </nav>
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
