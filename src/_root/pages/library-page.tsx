import { useStore } from 'jotai'
import { useRef, useState } from 'react'

import { LibraryView } from '@/components/library/library'
import { BoxScrollbar } from '@/components/shared/doc-scroll'
import { PageRefresh } from '@/components/shared/page-refresh'
import { syncLibrary } from '@/lib/library/sync'
import { requestSync } from '@/lib/offline/sync'
import { markStuck } from '@/lib/stuck-row'

// The installed app's Library tab, and where a Ctrl-click on the top bar's Library button goes: the same lists as
// the menu. Tapping Library at the top (the dock tab, or the top bar's button here) pulls the account's library and
// checks the offline copy for new lyrics
const LibraryPage = () => {
  const [box, setBox] = useState<HTMLElement | null>(null)
  const store = useStore()
  // Whether the controls have stuck under the top bar (the top scrim covers them then): data-stuck, set on the row
  // as the page scrolls, so a fling never shows it see-through over the list for a render's delay
  const header = useRef<HTMLElement>(null)
  const bar = useRef<HTMLDivElement>(null)

  return (
    <section
      ref={setBox}
      data-scroll-top
      data-refresh-page
      onScroll={(event) => {
        const bottom = header.current?.getBoundingClientRect().bottom ?? 0
        const controls = bar.current?.getBoundingClientRect()
        if (bar.current !== null && controls !== undefined) {
          markStuck(bar.current, bottom < controls.top - 0.5)
          // A row Tab moves to scrolls clear of the stuck controls, not under them
          const section = event.currentTarget
          section.style.scrollPaddingTop = `${controls.bottom - section.getBoundingClientRect().top}px`
        }
      }}
      className='flex flex-1 flex-col overflow-y-auto overscroll-contain pr-(--safe-right) pb-page-bottom pl-(--safe-left)'>
      <title>Library · Synbox</title>
      <LibraryView variant='page' headerRef={header} barRef={bar} />
      <BoxScrollbar box={box} />
      <PageRefresh
        path='/library'
        page={box}
        refresh={async () => {
          requestSync()
          await syncLibrary(store)
          return []
        }}
      />
    </section>
  )
}

export default LibraryPage
