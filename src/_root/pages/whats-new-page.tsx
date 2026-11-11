import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'

import { BoxScrollbar } from '@/components/shared/doc-scroll'
import { SiteLinks } from '@/components/shared/site-links'
import { entryDate, useWhatsNew, WHATS_NEW } from '@/lib/whats-new'

// Every release a listener would notice, newest first (lib/whats-new/entries.json). A link with an entry's id
// (#smoother-starts) opens on that entry; being here reads the newest
const WhatsNewPage = () => {
  const [box, setBox] = useState<HTMLElement | null>(null)
  const { hash } = useLocation()
  const { markSeen } = useWhatsNew()

  useEffect(() => {
    markSeen()
  }, [markSeen])

  // The page scrolls in its own box, which the browser's own jump to a #fragment doesn't reach
  useEffect(() => {
    if (box === null || hash === '') {
      return
    }
    box
      .querySelector(`#${CSS.escape(decodeURIComponent(hash.slice(1)))}`)
      ?.scrollIntoView({ block: 'start' })
  }, [box, hash])

  return (
    <section
      ref={setBox}
      data-scroll-top
      className='relative flex flex-1 flex-col overflow-y-auto pt-(--topbar-h) page-x pb-page-bottom-sm'>
      <title>What’s New · Synbox</title>

      <div className='mx-auto flex w-full max-w-2xl flex-col gap-8 pt-8 lg:pt-4'>
        <h1 className='text-center text-3xl font-bold'>What’s New</h1>

        {WHATS_NEW.map((entry) => (
          <section
            key={entry.id}
            id={entry.id}
            aria-labelledby={`${entry.id}-title`}
            className='flex scroll-mt-(--topbar-h) flex-col gap-3'>
            <header className='flex flex-col gap-0.5'>
              <h2 id={`${entry.id}-title`} className='font-semibold'>
                {entry.title}
              </h2>
              <p className='text-xs text-muted-foreground'>
                {entryDate(entry.date)}
              </p>
            </header>
            <ul className='flex flex-col gap-2 text-sm text-pretty text-muted-foreground'>
              {entry.items.map((item) => (
                // A drawn dot, centred on the first line (text-sm: 20px lines, a 4px dot 8px down)
                <li
                  key={item}
                  className="relative pl-4 before:absolute before:top-2 before:left-1 before:size-1 before:rounded-full before:bg-current before:content-['']">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <SiteLinks />
      <BoxScrollbar box={box} />
    </section>
  )
}

export default WhatsNewPage
