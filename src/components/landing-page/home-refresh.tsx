import { useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { PageRefresh } from '@/components/shared/page-refresh'
import { shouldRefetch } from '@/lib/home-refresh'
import { librarySongs } from '@/lib/react-query/queries-and-mutations'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'
import { getLandingPagePlaylist } from '@/lib/recommendations'
import { getLibrarySongs } from '@/lib/synbox-flask/discovery'
import { getChartsPlaylist } from '@/lib/youtube/api'
import { shuffleArray } from '@/utils'

// Back after this long away, the gallery comes back in a new order (below the fold, so nothing moves in view)
const AWAY_RESHUFFLE_MS = 30 * 60 * 1000

// Each list is fetched again only when its last fetch is older than the refetch window (a fetch comes back shuffled:
// getLibrarySongs, getLandingPagePlaylist); otherwise the recommendations and the gallery are reshuffled in place,
// which costs nothing, and the chart (a ranking) stays as it is
const LISTS: {
  queryKey: readonly unknown[]
  shuffles: boolean
  fetch: () => Promise<unknown>
}[] = [
  {
    fetch: getLandingPagePlaylist,
    queryKey: [QUERY_KEYS.GET_LANDING_PAGE_PLAYLIST],
    shuffles: true,
  },
  {
    fetch: getChartsPlaylist,
    queryKey: [QUERY_KEYS.GET_CHARTS_PLAYLIST],
    shuffles: false,
  },
  { fetch: getLibrarySongs, queryKey: librarySongs.queryKey, shuffles: true },
]

const reshuffle = (client: QueryClient, queryKey: readonly unknown[]) => {
  client.setQueryData<unknown[]>(queryKey, (list) =>
    list === undefined ? list : shuffleArray([...list])
  )
}

// The lists' new contents, fetched (or reshuffled) while the spinner shows and only put on screen once it has gone, so
// nothing changes under the spinner. A list whose fetch fails keeps what it had
const refreshLists = async (client: QueryClient) => {
  const now = Date.now()
  const updates: (() => void)[] = []
  await Promise.allSettled(
    LISTS.map(async ({ queryKey, shuffles, fetch }) => {
      const fetchedAt = client.getQueryState(queryKey)?.dataUpdatedAt ?? 0
      if (shouldRefetch(now, fetchedAt)) {
        const data = await fetch()
        updates.push(() => {
          client.setQueryData(queryKey, data)
        })
      } else if (shuffles) {
        updates.push(() => {
          reshuffle(client, queryKey)
        })
      }
    })
  )
  return updates
}

// Home's refresh, asked for by tapping Home at the top: its three lists (page-refresh.tsx draws the spinner).
// `page`: the landing page's scroller
export const HomeRefresh = ({ page }: { page: HTMLElement | null }) => {
  const client = useQueryClient()

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

  return (
    <PageRefresh
      path='/'
      page={page}
      refresh={async () => await refreshLists(client)}
    />
  )
}
