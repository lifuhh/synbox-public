import { useRef, useState } from 'react'

import {
  ShelfControls,
  ShelfResults,
  SyncStatusLine,
  useLyricsShelf,
} from '@/components/offline/lyrics-shelf'
import { BoxScrollbar } from '@/components/shared/doc-scroll'
import { markStuck } from '@/lib/stuck-row'

// The installed app's Lyrics tab; the top bar's Lyrics button opens the same list as a menu
const OfflinePage = () => {
  const [box, setBox] = useState<HTMLElement | null>(null)
  const shelf = useLyricsShelf()
  // Whether the search row has stuck under the top bar (the top scrim covers it then): data-stuck, set on the row as
  // the page scrolls, so a fling never shows it see-through over the list for a render's delay
  const header = useRef<HTMLElement>(null)
  const bar = useRef<HTMLDivElement>(null)

  return (
    <section
      ref={setBox}
      data-scroll-top
      onScroll={() => {
        // Stuck once the header has scrolled up past where the row holds
        const bottom = header.current?.getBoundingClientRect().bottom ?? 0
        const top = bar.current?.getBoundingClientRect().top ?? 0
        if (bar.current !== null) {
          markStuck(bar.current, bottom < top - 0.5)
        }
      }}
      className='flex custom-scrollbar flex-1 flex-col overflow-y-auto overscroll-contain pr-(--safe-right) pb-page-bottom pl-(--safe-left)'>
      <title>Lyrics · Synbox</title>
      <header
        ref={header}
        className='mx-auto w-full max-w-xl px-4 pt-page-top pb-1 text-center'>
        <h1 className='text-base font-semibold text-foreground'>Lyrics</h1>
        <SyncStatusLine shelf={shelf} />
      </header>

      <div ref={bar} className='sticky-under-topbar'>
        <div className='mx-auto flex w-full max-w-xl flex-col gap-2 px-4 py-2'>
          <ShelfControls
            shelf={shelf}
            chipsClassName='-mx-4 px-4 md:mx-0 md:px-0'
          />
        </div>
      </div>

      <div className='mx-auto w-full max-w-xl px-2'>
        <ShelfResults shelf={shelf} />
      </div>
      <BoxScrollbar box={box} />
    </section>
  )
}

export default OfflinePage
