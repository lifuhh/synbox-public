import { getStore } from '@netlify/blobs'

import { handleLibrarySongs } from '../library-songs'

const KEY = 'songs'

// The part of Netlify's function context used here: work that may finish after the answer is sent
interface Context {
  waitUntil: (work: Promise<unknown>) => void
}

const librarySongs = async (_request: Request, context: Context) => {
  const store = getStore('library-songs')
  return await handleLibrarySongs(
    {
      get: async () => await store.get(KEY),
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

export const config = { path: '/api/library/songs' }
