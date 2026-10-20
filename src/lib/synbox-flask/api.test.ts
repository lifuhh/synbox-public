import { describe, expect, test } from 'vite-plus/test'

import { fillProgress, tokenFillParts } from '@/lib/karaoke'

// Written by the backend's build_doc (KaraokeDoc v2) for a neutral line, so its shape is the real one
import karaokeV2 from './__fixtures__/karaoke-v2.json'
import { isKaraokeDoc } from './api'

describe('isKaraokeDoc', () => {
  test('accepts the backend’s version 2 doc, and the player can fill its lines', () => {
    const doc: unknown = karaokeV2
    if (!isKaraokeDoc(doc)) {
      throw new Error('the backend’s v2 doc was rejected')
    }
    const parts = tokenFillParts(doc.lines[0]).flat()
    const { end } = doc.lines[0]
    expect(parts.length).toBeGreaterThan(0)
    expect(parts.every((part) => fillProgress(part.spans, end) === 1)).toBe(
      true
    )
  })

  test('accepts version 1 and rejects versions the player does not know', () => {
    expect(isKaraokeDoc({ ...karaokeV2, version: 1 })).toBe(true)
    expect(isKaraokeDoc({ ...karaokeV2, version: 3 })).toBe(false)
  })
})
