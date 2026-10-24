import { expect, test } from 'vite-plus/test'

import { isoSeconds, mightBeJapaneseSong } from './song-guess'

const video = (
  overrides: Partial<Parameters<typeof mightBeJapaneseSong>[0]>
) => ({
  channelTitle: '',
  defaultAudioLanguage: '',
  duration: 'PT4M13S',
  tags: [],
  title: '',
  ...overrides,
})

test('a Japanese music video is offered; an English vlog and a long or live Japanese video are not', () => {
  expect(
    mightBeJapaneseSong(
      video({
        channelTitle: 'YOASOBI',
        title: 'YOASOBI「劇上」Official Music Video',
      })
    )
  ).toBe(true)
  // A romanised title still counts by its audio language
  expect(
    mightBeJapaneseSong(
      video({ defaultAudioLanguage: 'ja', title: 'Fujii Kaze - Matsuri' })
    )
  ).toBe(true)
  expect(
    mightBeJapaneseSong(
      video({
        channelTitle: 'MrBeast',
        defaultAudioLanguage: 'en',
        duration: 'PT25M41S',
        title: 'Eat Everything In A Grocery Store, Win $1,000,000',
      })
    )
  ).toBe(false)
  expect(
    mightBeJapaneseSong(video({ duration: 'PT1H2M', title: '作業用BGM 1時間' }))
  ).toBe(false)
  expect(mightBeJapaneseSong(video({ duration: 'P0D', title: '歌枠' }))).toBe(
    false
  )
})

test('ISO 8601 durations, and anything else unknown', () => {
  expect(isoSeconds('PT4M13S')).toBe(253)
  expect(isoSeconds('PT1H')).toBe(3600)
  expect(isoSeconds('P1DT1S')).toBe(86_401)
  expect(isoSeconds('-1')).toBeNull()
})
