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
// allows two). A home visit asks once, and the CDN answers most
export const config = {
  path: '/api/library/songs',
  rateLimit: { aggregateBy: ['ip', 'domain'], windowLimit: 30, windowSize: 60 },
}
