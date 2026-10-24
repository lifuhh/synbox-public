import { getStore } from '@netlify/blobs'

import { handleLibrarySongs } from '../library-songs'

const KEY = 'songs'

// The part of Netlify's function context used here: work that may finish after the answer is sent
interface Context {
  waitUntil: (work: Promise<unknown>) => void
}

const librarySongs = async (request: Request, context: Context) => {
  const store = getStore('library-songs')
  return await handleLibrarySongs(
    request,
    {
      get: async () => await store.get(KEY, { type: 'text' }),
      set: async (body) => {
        await store.set(KEY, body)
      },
    },
    (work) => {
      context.waitUntil(work)
    }
  )
}

export default librarySongs

// Netlify answers past this many requests a minute from one address with 429 (a code-based rule: every plan
// allows two). It counts the requests the CDN answers too (rate limiting runs before the edge cache), and a
// phone carrier puts many people behind one address, so the limit is set for a crowd, not one visitor. A query
// is refused with 400, so the one cached list is all a flood can ask for
export const config = {
  path: '/api/library/songs',
  rateLimit: {
    aggregateBy: ['ip', 'domain'],
    windowLimit: 300,
    windowSize: 60,
  },
}
