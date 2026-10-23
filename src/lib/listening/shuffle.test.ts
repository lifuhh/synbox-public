import { describe, expect, it } from 'vite-plus/test'

import type { Random } from './shuffle'
import { cryptoRandom, fisherYates, spreadShuffle } from './shuffle'

// Park–Miller's minimal standard generator, seeded, so each run checks the same thousand shuffles
const MODULUS = 2_147_483_647
const seeded = (seed: number): Random => {
  let state = seed
  return () => {
    state = (state * 48_271) % MODULUS
    return state / MODULUS
  }
}

// Two artists, six songs each
const songs = Array.from({ length: 12 }, (_, i) => ({
  artist: i % 2 === 0 ? 'Ado' : 'Yoasobi',
  id: `s${i}`,
}))
const artistOf = (song: (typeof songs)[number]) => song.artist
const sameArtistPairs = (order: typeof songs) =>
  order.slice(1).filter((song, i) => song.artist === order[i].artist).length

describe('shuffles', () => {
  it('plays every song exactly once', () => {
    const order = spreadShuffle(songs, artistOf, cryptoRandom)
    expect(order.map((s) => s.id).toSorted()).toEqual(
      songs.map((s) => s.id).toSorted()
    )
  })

  it('gives a different order each time', () => {
    const orders = new Set(
      Array.from({ length: 20 }, () =>
        spreadShuffle(songs, artistOf, cryptoRandom)
          .map((s) => s.id)
          .join(',')
      )
    )
    expect(orders.size).toBeGreaterThan(15)
  })

  it('keeps one artist from playing back to back far more often than a plain shuffle', () => {
    let spread = 0
    let plain = 0
    for (let seed = 1; seed <= 1000; seed += 1) {
      spread += sameArtistPairs(spreadShuffle(songs, artistOf, seeded(seed)))
      plain += sameArtistPairs(fisherYates(songs, seeded(seed)))
    }
    // A plain shuffle of 6 + 6 averages 5 same-artist neighbours in 11
    expect(plain / 1000).toBeGreaterThan(4)
    expect(spread / 1000).toBeLessThan(1)
  })

  it('leans to no order: each song starts a plain shuffle about as often as any other', () => {
    const firsts = new Map<string, number>()
    const random = seeded(7)
    for (let i = 0; i < 12_000; i += 1) {
      const first = fisherYates(songs, random)[0].id
      firsts.set(first, (firsts.get(first) ?? 0) + 1)
    }
    for (const count of firsts.values()) {
      expect(count).toBeGreaterThan(850)
      expect(count).toBeLessThan(1150)
    }
  })
})
