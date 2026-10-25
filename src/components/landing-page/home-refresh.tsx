import { useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { LoaderCircleIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { onHomeRefresh, shouldRefetch } from '@/lib/home-refresh'
import { librarySongs } from '@/lib/react-query/queries-and-mutations'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'
import { shuffleArray } from '@/utils'

// The spinner shows at least this long, so a refresh that only reshuffles still reads as one
const MIN_SHOWN_MS = 600
// A slow network doesn't hold the page down: the lists land when they land
const MAX_SHOWN_MS = 4000
// Back after this long away, the gallery comes back in a new order (below the fold, so nothing moves in view)
const AWAY_RESHUFFLE_MS = 30 * 60 * 1000

// Each list is fetched again only when its last fetch is older than the refetch window (a fetch comes back shuffled:
// getLibrarySongs, getLandingPagePlaylist); otherwise the recommendations and the gallery are reshuffled in place,
// which costs nothing, and the chart (a ranking) stays as it is
const LISTS: { queryKey: readonly unknown[]; shuffles: boolean }[] = [
  { queryKey: [QUERY_KEYS.GET_LANDING_PAGE_PLAYLIST], shuffles: true },
  { queryKey: [QUERY_KEYS.GET_CHARTS_PLAYLIST], shuffles: false },
  { queryKey: librarySongs.queryKey, shuffles: true },
]

const reshuffle = (client: QueryClient, queryKey: readonly unknown[]) => {
  client.setQueryData<unknown[]>(queryKey, (list) =>
    list === undefined ? list : shuffleArray([...list])
  )
}

const refreshLists = async (client: QueryClient) => {
  const now = Date.now()
  await Promise.allSettled(
    LISTS.map(async ({ queryKey, shuffles }) => {
      const fetchedAt = client.getQueryState(queryKey)?.dataUpdatedAt ?? 0
      if (shouldRefetch(now, fetchedAt)) {
        await client.refetchQueries({ queryKey })
      } else if (shuffles) {
        reshuffle(client, queryKey)
      }
    })
  )
}

// Home's refresh, asked for by tapping Home at the top (tab-bar.tsx › requestHomeRefresh): the page slides down to
// show a spinner under the top bar while the lists refresh, then back (globals.css › home-refresh-spinner). Reduced
// motion keeps only the spinner's fade. `page`: the landing page's scroller
export const HomeRefresh = ({ page }: { page: HTMLElement | null }) => {
  const client = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let started = 0
    let worked = false
    let timer = 0
    // Down for MIN_SHOWN_MS and until the lists answer, never past MAX_SHOWN_MS
    const settle = () => {
      const shown = performance.now() - started
      if (worked || shown >= MAX_SHOWN_MS) {
        window.clearTimeout(timer)
        timer = window.setTimeout(
          () => {
            started = 0
            setRefreshing(false)
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
      await refreshLists(client)
      worked = true
      settle()
    }
    const stop = onHomeRefresh(() => {
      void run()
    })
    return () => {
      stop()
      window.clearTimeout(timer)
    }
  }, [client])

  useEffect(() => {
    page?.toggleAttribute('data-refreshing', refreshing)
  }, [page, refreshing])

  // An installed app is resumed, not reloaded, so without this the gallery kept one order for as long as the app
  // stayed in memory. Only while Home sits at its top, so a gallery being browsed never reorders under the reader
  useEffect(() => {
    let hiddenAt = 0
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      if (
        hiddenAt !== 0 &&
        Date.now() - hiddenAt >= AWAY_RESHUFFLE_MS &&
        (page?.scrollTop ?? 0) <= 2
      ) {
        reshuffle(client, librarySongs.queryKey)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [page, client])

  return createPortal(
    <output
      data-shown={refreshing || undefined}
      className='home-refresh-spinner'>
      <LoaderCircleIcon
        aria-hidden
        className='size-5 motion-safe:animate-spin'
      />
      <span className='sr-only'>{refreshing ? 'Refreshing' : ''}</span>
    </output>,
    document.body
  )
}
