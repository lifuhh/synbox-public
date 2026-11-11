// What's New: one entry per release that changed anything a listener sees, newest first, in entries.json. How to
// write one, and what never goes in it: docs/whats-new.md. Plain data and functions only: harness/release.ts reads
// this module too

import { z } from 'zod'

// The whole entry for a release that only fixed things and sped things up
export const BUG_FIXES = 'Bug fixes and performance improvements'

const text = z.string().trim().min(1)

// One release. `date` is the day it went live (YYYY-MM-DD); null for the entry the next release ships, which
// harness/release.ts stamps with the ship date
const entrySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u)
    .nullable(),
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  items: z.array(text).min(1),
  title: text,
})
export type WhatsNewEntry = z.infer<typeof entrySchema>

// The entries as written, checked once: unique ids, newest first, at most one undated (the one shipping next) and
// only at the top. Throws on a malformed file, so a bad entry fails the build's tests rather than the page
export const parseEntries = (raw: unknown): WhatsNewEntry[] => {
  const parsed = z.array(entrySchema).safeParse(raw)
  if (!parsed.success) {
    throw new Error(
      'whats-new entries.json: every entry needs id, date, title and items'
    )
  }
  const entries = parsed.data
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new Error('whats-new entries.json: ids must be unique')
  }
  for (const [index, entry] of entries.entries()) {
    if (entry.date === null && index !== 0) {
      throw new Error(
        'whats-new entries.json: only the newest entry may be undated'
      )
    }
    const next = entries[index + 1]
    if (
      entry.date !== null &&
      next !== undefined &&
      next.date !== null &&
      next.date > entry.date
    ) {
      throw new Error('whats-new entries.json: newest first')
    }
  }
  return entries
}

// Whether the bell shows the newest entry: the listener hasn't seen it yet, and they knew Synbox before it (a
// returning browser, or an account that saw an older entry). Someone new to Synbox isn't told what changed
export const whatsNewUnread = (
  latest: string | null,
  seen: string | null,
  returning: boolean
) => latest !== null && latest !== seen && (seen !== null || returning)

// "12 Nov 2026"; an entry not yet shipped (a local or staging build) reads "Next Update"
export const entryDate = (date: string | null) =>
  date === null
    ? 'Next Update'
    : new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
        year: 'numeric',
      }).format(new Date(`${date}T00:00:00Z`))
