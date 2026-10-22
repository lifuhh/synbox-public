// The top bar's instant search: songs already in the library whose title or channel holds every word typed,
// matched in the browser against the list the app has loaded anyway, so typing costs no request. The full
// search (ranked by meaning, and YouTube's videos) is the search page's

interface Searchable {
  title: string
  author: string
}

// Full-width and half-width forms, case and accents read alike: "ＹＯＡＳＯＢＩ" finds "YOASOBI", "cafe" finds "café"
const fold = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replaceAll(/\p{Mn}/gu, '')

// Best first: a title that starts with the query, then one that holds it whole, then any song holding every word
const rank = (title: string, query: string) => {
  if (title.startsWith(query)) {
    return 0
  }
  return title.includes(query) ? 1 : 2
}

export const matchTitles = <T extends Searchable>(
  songs: readonly T[],
  rawQuery: string,
  limit: number
): T[] => {
  const query = fold(rawQuery.trim())
  if (query === '') {
    return []
  }
  const words = query.split(/\s+/u)
  return songs
    .map((song) => ({
      author: fold(song.author),
      song,
      title: fold(song.title),
    }))
    .filter(({ title, author }) =>
      words.every((word) => title.includes(word) || author.includes(word))
    )
    .map((entry) => ({ ...entry, rank: rank(entry.title, query) }))
    .toSorted((a, b) => a.rank - b.rank || a.title.length - b.title.length)
    .slice(0, limit)
    .map(({ song }) => song)
}
