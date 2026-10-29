// The clean moments for README captures: short, verified karaoke lines with a short English translation, across the
// library. Prints where each one is (video id, line, start, end) and never the lyric text, which stays out of the repo.
//
//   bun harness/readme/moments.ts            the best moments, most per song first (12 songs; --all for every one)
//   bun harness/readme/moments.ts <videoId>  that song's moments only

const LIBRARY = 'https://synbox.io/api/library/songs'
const KARAOKE = 'https://api.synbox.io/api/karaoke'
// One line on a phone, under the video, at the default size: 5 to 11 characters, romaji and translation that fit
const FITS = {
  english: [8, 30],
  japanese: [5, 11],
  romaji: 30,
  seconds: [2.2, 6],
} as const

export interface Moment {
  end: number
  line: number
  start: number
  videoId: string
}

interface KaraokeLine {
  end: number
  romaji: string
  start: number
  status: string
  text: string
}

const getJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`)
  }
  return await response.json()
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const libraryIds = async () => {
  const body = await getJson(LIBRARY)
  const songs = isRecord(body) && Array.isArray(body.songs) ? body.songs : []
  return songs
    .filter(
      (song): song is Record<string, unknown> =>
        isRecord(song) && song.karaoke === true
    )
    .map((song) => String(song.video_id))
}

const isLine = (value: unknown): value is KaraokeLine =>
  isRecord(value) &&
  typeof value.end === 'number' &&
  typeof value.romaji === 'string' &&
  typeof value.start === 'number' &&
  typeof value.status === 'string' &&
  typeof value.text === 'string'

const within = (value: number, [low, high]: readonly [number, number]) =>
  value >= low && value <= high

export const momentsOf = async (videoId: string): Promise<Moment[]> => {
  const doc = await getJson(`${KARAOKE}/${encodeURIComponent(videoId)}`)
  if (!isRecord(doc) || !Array.isArray(doc.lines)) {
    return []
  }
  const translations = isRecord(doc.translations) ? doc.translations : {}
  const english =
    isRecord(translations.en) && Array.isArray(translations.en.lines)
      ? translations.en.lines
      : []
  return doc.lines.flatMap((line: unknown, index) => {
    const translation = typeof english[index] === 'string' ? english[index] : ''
    const fits =
      isLine(line) &&
      line.status === 'verified' &&
      within(line.text.replaceAll(' ', '').length, FITS.japanese) &&
      line.romaji.length <= FITS.romaji &&
      within(translation.length, FITS.english) &&
      within(line.end - line.start, FITS.seconds)
    return fits
      ? [{ end: line.end, line: index, start: line.start, videoId }]
      : []
  })
}

if (import.meta.main) {
  const all = process.argv.includes('--all')
  const only = process.argv.slice(2).find((arg) => arg !== '--all')
  const ids = only === undefined ? await libraryIds() : [only]
  const found: Moment[][] = []
  for (let i = 0; i < ids.length; i += 6) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- six songs at a time, not the whole library at once
    const batch = await Promise.all(
      ids.slice(i, i + 6).map(async (id) => await momentsOf(id).catch(() => []))
    )
    found.push(...batch)
  }
  const ranked = found
    .filter((moments) => moments.length > 0)
    .toSorted((a, b) => b.length - a.length)
  console.log(`${ranked.length} of ${ids.length} songs have moments`)
  for (const moments of all ? ranked : ranked.slice(0, 12)) {
    const times = moments.map(
      (m) => `${m.line}@${m.start.toFixed(1)}-${m.end.toFixed(1)}`
    )
    console.log(`${moments[0]?.videoId}  ${moments.length}  ${times.join(' ')}`)
  }
}
