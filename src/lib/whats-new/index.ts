import { useAtom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { useCallback } from 'react'

import { syncedStorage } from '@/lib/prefs/storage'
import { returningVisitor } from '@/lib/pwa'

import raw from './entries.json'
import { parseEntries, whatsNewUnread } from './model'
import type { WhatsNewEntry } from './model'

export { BUG_FIXES, entryDate, recentCount } from './model'
export type { WhatsNewEntry } from './model'

export const WHATS_NEW: readonly WhatsNewEntry[] = parseEntries(raw)
export const LATEST_ENTRY: WhatsNewEntry | undefined = WHATS_NEW[0]

// The newest entry the listener has seen, synced with their account (prefs/model.ts › SYNCED_KEYS), so a signed-in
// listener hears about a release once, on whichever device they open first; a guest, once per browser
export const WHATS_NEW_SEEN_KEY = 'whatsNewSeen'
const seenAtom = atomWithStorage<string | null>(
  WHATS_NEW_SEEN_KEY,
  null,
  syncedStorage(),
  { getOnInit: true }
)

export const whatsNewPath = (entry?: WhatsNewEntry) =>
  entry === undefined ? '/whats-new' : `/whats-new#${entry.id}`

// Whether the newest entry is still news to this listener, and the call that marks it read
export const useWhatsNew = () => {
  const [seen, setSeen] = useAtom(seenAtom)
  const latest = LATEST_ENTRY?.id ?? null
  const unread = whatsNewUnread(latest, seen, returningVisitor)
  const markSeen = useCallback(() => {
    if (latest !== null) {
      setSeen(latest)
    }
  }, [latest, setSeen])
  return { latest: LATEST_ENTRY, markSeen, seen, unread }
}
