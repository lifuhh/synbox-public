// A number in [0, 1). Shuffles take one so tests can pass a seeded one
export type Random = () => number

// From the platform's cryptographic source, never seeded: no two shuffles share an order by design (Math.random
// is fine for this too; a fixed seed, or sort() with a random comparator, is what makes "random" repeat or lean)
export const cryptoRandom: Random = () =>
  crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32

// Fisher–Yates (Durstenfeld): every order equally likely, each item once
export const fisherYates = <T>(items: readonly T[], random: Random): T[] => {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// How far a song may stray from its evenly spread place, as a share of the gap between its artist's songs:
// enough that the pattern doesn't show, too little to swap two songs of one artist
const JITTER = 0.2

// Spotify's shuffle (engineering.atspotify.com/2014/02/how-to-shuffle-songs): a fully random order puts one
// artist's songs side by side often enough to feel broken. Each artist's songs, in a random order of their own,
// are spread evenly along the list from a random start, with a little jitter, and every song is then sorted by
// its place. Every song still plays once, the order differs every time, and one artist rarely plays twice in a
// row
export const spreadShuffle = <T>(
  items: readonly T[],
  artistOf: (item: T) => string,
  random: Random
): T[] => {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const artist = artistOf(item)
    groups.set(artist, [...(groups.get(artist) ?? []), item])
  }
  const placed: { item: T; at: number }[] = []
  for (const group of groups.values()) {
    const gap = 1 / group.length
    const start = random() * gap
    for (const [index, item] of fisherYates(group, random).entries()) {
      placed.push({
        at: start + index * gap + (random() - 0.5) * gap * JITTER,
        item,
      })
    }
  }
  return placed.toSorted((a, b) => a.at - b.at).map(({ item }) => item)
}
