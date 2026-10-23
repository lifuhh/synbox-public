import { useState } from 'react'

import { BoxScrollbar } from '@/components/shared/doc-scroll'

// What the code keeps about a person and why: the Worker's D1 tables (worker/migrations), Google sign-in
// (worker/src/auth.ts) and Sentry (src/instrument.ts). Change it when they change
const SECTIONS = [
  {
    items: [
      'Your Google name, email, profile picture and account id, from Google sign-in.',
      'Your signed-in sessions, with the browser and IP address they came from.',
      'Songs you generated and when, with a one-way code made from your network and your browser name, for the limits.',
      'Your history, saved songs, playlists and settings, so they follow you to other devices.',
      'Lyrics reports you send.',
      'Without an account: a one-way code made from your network counts your free song, and a random id in your browser counts your likes.',
    ],
    title: 'What We Store',
  },
  {
    items: [
      'To sign you in and sync your library.',
      'To keep limits fair: every new song costs money to make.',
      'To fix the lyrics you report and the errors the app hits.',
      'No ads, and nothing is sold.',
    ],
    title: 'Why',
  },
  {
    items: [
      'Accounts and libraries: Cloudflare.',
      'Lyrics are made on Google Cloud, which gets your account id only, not your name or email.',
      'Songs and lyrics: Appwrite. No personal data.',
      'Error reports: Sentry, with on-screen text masked.',
      "The site's admin sees accounts and who generated which song, to manage limits.",
    ],
    title: 'Where It Lives',
  },
  {
    items: [
      'Everything in the library plays without signing in.',
      'Sign out from the profile menu any time.',
      'To see or delete your data, ask on LinkedIn or GitHub. Deleting removes your account and everything tied to it.',
    ],
    title: 'Your Choices',
  },
]

// A window-high box that scrolls under the top bar, as home and the lists do, so it gets their scrollbar
const PrivacyPage = () => {
  const [box, setBox] = useState<HTMLElement | null>(null)
  return (
    <section
      ref={setBox}
      data-scroll-top
      className='relative flex custom-scrollbar flex-1 flex-col overflow-y-auto pt-(--topbar-h) page-x pb-page-bottom-sm'>
      <title>Privacy | Synbox</title>

      <div className='mx-auto flex w-full max-w-2xl flex-col gap-8 pt-8'>
        <header className='flex flex-col gap-3 text-center'>
          <h1 className='text-3xl font-bold'>Privacy</h1>
          <p className='text-sm text-muted-foreground'>
            Updated 23 October 2026
          </p>
        </header>

        {SECTIONS.map((section) => (
          <section key={section.title} className='flex flex-col gap-3'>
            <h2 className='font-semibold'>{section.title}</h2>
            <ul className='flex flex-col gap-2 text-sm text-pretty text-muted-foreground'>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <nav
        aria-label='Links'
        className='mx-auto flex gap-6 pt-8 text-sm text-muted-foreground'>
        <a
          href='https://www.linkedin.com/in/lifuhh/'
          target='_blank'
          rel='noreferrer'
          className='hover:text-foreground'>
          LinkedIn
        </a>
      </nav>
      <BoxScrollbar box={box} />
    </section>
  )
}

export default PrivacyPage
