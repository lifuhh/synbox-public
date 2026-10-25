import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { BoxScrollbar } from '@/components/shared/doc-scroll'

export interface LegalSection {
  title: string
  items: ReactNode[]
}

// A link inside the lists' text. Its vertical padding makes the press area at least 24px tall (WCAG 2.2's minimum) without
// moving the line
export const INLINE_LINK =
  'py-1 underline underline-offset-2 hover:text-foreground'

// A link out of the app, in the lists' own text
export const Ext = ({
  href,
  children,
}: {
  href: string
  children: ReactNode
}) => (
  <a href={href} target='_blank' rel='noreferrer' className={INLINE_LINK}>
    {children}
  </a>
)

// Privacy and Terms: a window-high box that scrolls under the top bar, as home and the lists do, so it gets their
// scrollbar. From lg the sections flow in three columns
export const LegalPage = ({
  title,
  updated,
  sections,
}: {
  title: string
  updated: string
  sections: LegalSection[]
}) => {
  const [box, setBox] = useState<HTMLElement | null>(null)
  return (
    <section
      ref={setBox}
      data-scroll-top
      className='relative flex flex-1 flex-col overflow-y-auto pt-(--topbar-h) page-x pb-page-bottom-sm'>
      <title>{`${title} · Synbox`}</title>

      <div className='mx-auto flex w-full max-w-2xl flex-col gap-8 pt-8 lg:max-w-6xl lg:gap-6 lg:pt-4'>
        <header className='flex flex-col gap-3 text-center'>
          <h1 className='text-3xl font-bold'>{title}</h1>
          <p className='text-sm text-muted-foreground'>Updated {updated}</p>
        </header>

        <div className='flex flex-col gap-8 lg:block lg:columns-3 lg:gap-x-10'>
          {sections.map((section) => (
            <section
              key={section.title}
              className='flex flex-col gap-3 lg:break-inside-avoid lg:not-last:mb-6'>
              <h2 className='font-semibold'>{section.title}</h2>
              <ul className='flex flex-col gap-2 text-sm text-pretty text-muted-foreground'>
                {section.items.map((item, index) => (
                  // oxlint-disable-next-line react/no-array-index-key -- a fixed list, never reordered
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <nav
        aria-label='Links'
        className='mx-auto flex gap-6 pt-8 text-sm text-muted-foreground'>
        <a
          href='https://www.linkedin.com/in/lifuhh/'
          target='_blank'
          rel='noreferrer'
          className='py-0.5 hover:text-foreground'>
          LinkedIn
        </a>
        <Link to='/privacy' className='py-0.5 hover:text-foreground'>
          Privacy
        </Link>
        <Link to='/terms' className='py-0.5 hover:text-foreground'>
          Terms
        </Link>
      </nav>
      <BoxScrollbar box={box} />
    </section>
  )
}
