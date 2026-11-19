// The Search page's suggestions at rest: a source, a sound and a tempo, so they show three different ways to ask.
// They name kinds of music, never a feeling or a life moment, which would read as the site's own taste.
// Each was checked to find 20 karaoke songs (`bun harness/search-probe.ts --examples`, 2026-11-20); run it again when
// the library or the search changes. Narrow themes ("Summer Songs", "City Pop", "Slow Ballads") found none
export const SEARCH_EXAMPLES = [
  'Anime Theme Songs',
  'Rock Bands',
  'Upbeat Songs',
] as const
