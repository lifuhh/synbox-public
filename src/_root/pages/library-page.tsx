import { useRef, useState } from 'react'

import { LibraryView } from '@/components/library/library'
import { BoxScrollbar } from '@/components/shared/doc-scroll'
import { markStuck } from '@/lib/stuck-row'

// The installed app's Library tab, and where a Ctrl-click on the top bar's Library button goes: the same lists as
// the menu
const LibraryPage = () => {
  const [box, setBox] = useState<HTMLElement | null>(null)
  // Whether the controls have stuck under the top bar (the top scrim covers them then): data-stuck, set on the row
  // as the page scrolls, so a fling never shows it see-through over the list for a render's delay
  const header = useRef<HTMLElement>(null)
  const bar = useRef<HTMLDivElement>(null)

  return (
    <section
      ref={setBox}
      data-scroll-top
      onScroll={() => {
        const bottom = header.current?.getBoundingClientRect().bottom ?? 0
        const top = bar.current?.getBoundingClientRect().top ?? 0
        if (bar.current !== null) {
          markStuck(bar.current, bottom < top - 0.5)
        }
      }}
      className='flex custom-scrollbar flex-1 flex-col overflow-y-auto overscroll-contain pr-(--safe-right) pb-page-bottom pl-(--safe-left)'>
      <title>Library · Synbox</title>
      <LibraryView variant='page' headerRef={header} barRef={bar} />
      <BoxScrollbar box={box} />
    </section>
  )
}

export default LibraryPage
