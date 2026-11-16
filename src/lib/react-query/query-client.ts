import { QueryClient } from '@tanstack/react-query'

import { persistQueries } from './persist'

// How long the first render waits for the kept lists (persist.ts). The page's static shell shows meanwhile; a
// slower read still lands, over the placeholders
const RESTORE_WAIT_MS = 150

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // One more try, then the error and its Retry button: the fetchers throw plain errors, so a refusal (4xx)
      // can't be told from an outage, and three retries with backoff asked a refusing server four times
      retry: 1,
      // A page that remounts its readers, or Back within moments, reads the answer it has. Short, so a query that
      // sets none (the admin lists, a song's stats) still refetches on a return to the window
      staleTime: 10_000,
    },
  },
})

// Resolves when the lists kept from the last visit are in the cache, or the wait is over; never rejects
export const lastDataRestored = async () => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      persistQueries(queryClient),
      // oxlint-disable-next-line promise/avoid-new -- turns setTimeout into a promise; Promise.withResolvers is ES2024
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, RESTORE_WAIT_MS)
      }),
    ])
  } catch {
    // The app opens without the kept lists
  } finally {
    clearTimeout(timer)
  }
}
