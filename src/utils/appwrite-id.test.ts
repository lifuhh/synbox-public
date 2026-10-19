import { describe, expect, test } from 'vite-plus/test'

import {
  createAppwriteIdFromYoutubeId,
  legacyAppwriteIdFromYoutubeId,
} from '@/utils'

describe('Appwrite song ids', () => {
  test('keeps inner dashes and encodes only a leading - or _, like the backend', () => {
    expect(createAppwriteIdFromYoutubeId('ZSr3P-Rn6x0')).toBe('ZSr3P-Rn6x0')
    expect(createAppwriteIdFromYoutubeId('-tKVN2mAKRI')).toBe('yt_htKVN2mAKRI')
    expect(createAppwriteIdFromYoutubeId('_XeE2aEiPHk')).toBe('yt_uXeE2aEiPHk')
    expect(createAppwriteIdFromYoutubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  test('still produces the pre-migration ids seen in production', () => {
    expect(legacyAppwriteIdFromYoutubeId('ZSr3P-Rn6x0')).toBe('yt_ZSr3P_Rn6x0')
    expect(legacyAppwriteIdFromYoutubeId('_XeE2aEiPHk')).toBe('yt__XeE2aEiPHk')
    expect(legacyAppwriteIdFromYoutubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
})
