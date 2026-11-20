import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'

import { BoxScrollbar } from '@/components/shared/doc-scroll'
import { SiteLinks } from '@/components/shared/site-links'
import { entryDate, recentCount, useWhatsNew, WHATS_NEW } from '@/lib/whats-new'
import type { WhatsNewEntry } from '@/lib/whats-new'

const Entry = ({ entry }: { entry: WhatsNewEntry }) => (
  <section
    id={entry.id}
    aria-labelledby={`${entry.id}-title`}
    className='flex scroll-mt-(--topbar-h) flex-col gap-3'>
    <header className='flex flex-col gap-0.5'>
      <h2 id={`${entry.id}-title`} className='font-semibold'>
        {entry.title}
      </h2>
      <p className='text-xs text-muted-foreground'>{entryDate(entry.date)}</p>
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
)

// Every release a listener would notice, newest first (lib/whats-new/entries.json). What was news when the page
// opened (lib/whats-new › recentCount: the entries since the one last seen, at least the newest) sits on top; the
// rest under an Earlier Updates divider, so a visit reads only what's new. A link with an entry's id
// (#smoother-starts) opens on that entry; being here reads the newest
const WhatsNewPage = () => {
  const [box, setBox] = useState<HTMLElement | null>(null)
  const { hash } = useLocation()
  const { markSeen, seen } = useWhatsNew()
  // Read before markSeen below moves it to the newest
  // oxlint-disable-next-line react/hook-use-state -- fixed on the first render, never set: the split mustn't move once the visit reads the newest
  const [recent] = useState(() =>
    recentCount(
      WHATS_NEW.map((entry) => entry.id),
      seen
    )
  )
  const earlier = WHATS_NEW.slice(recent)

  useEffect(() => {
    markSeen()
  }, [markSeen])

  // The page scrolls in its own box, which the browser's own jump to a #fragment doesn't reach. The newest entry
  // already sits under the title, so a link to it stays at the top instead of scrolling the title away
  useEffect(() => {
    const id = decodeURIComponent(hash.slice(1))
    if (box === null || id === '' || id === WHATS_NEW[0]?.id) {
      return
    }
    box.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ block: 'start' })
  }, [box, hash])

  return (
    <section
      ref={setBox}
      data-scroll-top
      className='relative flex flex-1 flex-col overflow-y-auto pt-(--topbar-h) page-x pb-page-bottom-sm'>
      <title>What’s New · Synbox</title>

      <div className='mx-auto flex w-full max-w-2xl flex-col gap-8 pt-8 select-text lg:pt-4'>
        <h1 className='text-center text-3xl font-bold'>What’s New</h1>

        {WHATS_NEW.slice(0, recent).map((entry) => (
          <Entry key={entry.id} entry={entry} />
        ))}

        {earlier.length > 0 && (
          <>
            {/* Half again the gap between entries around it, so the two groups read apart */}
            <div
              data-bench='whats-new-earlier'
              className='my-4 flex items-center gap-3 text-xs font-medium text-muted-foreground'>
              <span aria-hidden className='h-px flex-1 bg-border' />
              Earlier Updates
              <span aria-hidden className='h-px flex-1 bg-border' />
            </div>
            {earlier.map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
          </>
        )}
      </div>

      <SiteLinks />
      <BoxScrollbar box={box} />
    </section>
  )
}

export default WhatsNewPage
