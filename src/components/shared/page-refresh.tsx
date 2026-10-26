import { LoaderCircleIcon } from 'lucide-react'
import { useEffect, useEffectEvent, useState } from 'react'
import { createPortal } from 'react-dom'

import { onPageRefresh } from '@/lib/home-refresh'

// The spinner shows at least this long, so a refresh with nothing new still reads as one
const MIN_SHOWN_MS = 600
// The page's slide back up (globals.css › page-refresh, translate 320ms)
const COLLAPSE_MS = 320
// A slow network doesn't hold the page down: what it fetches lands when it lands
const MAX_SHOWN_MS = 4000

// A tab page's refresh, asked for by tapping its tab at the top (tab-bar.tsx, the top bar's Library button ›
// requestPageRefresh): the page (marked data-refresh-page) slides down to show a spinner under the top bar while
// `refresh` runs, then back (globals.css › page-refresh-spinner). Reduced motion keeps only the spinner's fade.
// `refresh` resolves to the changes to put on screen once the spinner has gone, so nothing changes under it.
// `page`: the page's scroller; `path`: the tab's path
export const PageRefresh = ({
  path,
  page,
  refresh,
}: {
  path: string
  page: HTMLElement | null
  refresh: () => Promise<(() => void)[]>
}) => {
  const [refreshing, setRefreshing] = useState(false)
  const load = useEffectEvent(refresh)

  useEffect(() => {
    let started = 0
    let worked = false
    let timer = 0
    let updates: (() => void)[] = []
    // Down for MIN_SHOWN_MS and until the refresh answers, never past MAX_SHOWN_MS
    const settle = () => {
      const shown = performance.now() - started
      if (worked || shown >= MAX_SHOWN_MS) {
        window.clearTimeout(timer)
        timer = window.setTimeout(
          () => {
            started = 0
            setRefreshing(false)
            // After the page has slid back up
            const ready = updates
            updates = []
            timer = window.setTimeout(() => {
              for (const update of ready) {
                update()
              }
            }, COLLAPSE_MS)
          },
          Math.max(0, MIN_SHOWN_MS - shown)
        )
      }
    }
    const run = async () => {
      if (started !== 0) {
        return
      }
      started = performance.now()
      worked = false
      setRefreshing(true)
      timer = window.setTimeout(settle, MAX_SHOWN_MS)
      updates = await load().catch(() => [])
      worked = true
      settle()
    }
    const stop = onPageRefresh(path, () => {
      void run()
    })
    return () => {
      stop()
      window.clearTimeout(timer)
    }
  }, [path])

  useEffect(() => {
    page?.toggleAttribute('data-refreshing', refreshing)
  }, [page, refreshing])

  return createPortal(
    <output
      data-shown={refreshing || undefined}
      className='page-refresh-spinner'>
      <LoaderCircleIcon
        aria-hidden
        className='size-5 motion-safe:animate-spin'
      />
      <span className='sr-only'>{refreshing ? 'Refreshing' : ''}</span>
    </output>,
    document.body
  )
}
