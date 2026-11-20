import { useEffect, useSyncExternalStore } from 'react'
import { z } from 'zod'

const STORE = 'synbox:cover-zoom'

const readStore = () => {
  try {
    const stored = z
      .record(z.string(), z.number().min(1).max(2))
      .safeParse(JSON.parse(localStorage.getItem(STORE) ?? '{}'))
    return stored.success ? stored.data : {}
  } catch {
    return {}
  }
}

// Measured once per song and kept, so on later visits the picture is drawn zoomed from its first frame
const known = new Map<string, number>(Object.entries(readStore()))
const asked = new Set<string>()
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// The pixel reading loads on demand, after the page: the first load carries only this store. A picture that
// can't be read is not recorded, so the next visit asks again
const measure = async (videoId: string) => {
  const { measureCover } = await import('@/lib/cover-zoom')
  const zoom = await measureCover(videoId)
  if (zoom === null) {
    return
  }
  known.set(videoId, zoom)
  try {
    localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(known)))
  } catch {
    // Storage is full or blocked: the measurement still holds for this visit
  }
  for (const listener of listeners) {
    listener()
  }
}

/** The scale at which a song's YouTube picture fills a 16:9 frame with no black bars (`lib/cover-zoom.ts`):
 *  1 until it is measured */
export const useCoverZoom = (videoId: string): number => {
  useEffect(() => {
    if (!known.has(videoId) && !asked.has(videoId)) {
      asked.add(videoId)
      void measure(videoId)
    }
  }, [videoId])

  return useSyncExternalStore(subscribe, () => known.get(videoId) ?? 1)
}
