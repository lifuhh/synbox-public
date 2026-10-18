import { describe, expect, test } from 'vite-plus/test'

import { parseFurigana } from './furigana'

describe('parseFurigana', () => {
  test('splits per-kanji readings with okurigana outside the brackets', () => {
    expect(parseFurigana('運[うん]命[めい]が輝[かがや]く')).toEqual([
      { base: '運', rt: 'うん' },
      { base: '命', rt: 'めい' },
      { base: 'が', rt: '' },
      { base: '輝', rt: 'かがや' },
      { base: 'く', rt: '' },
    ])
  })

  test('keeps group ruby and 々 with their run', () => {
    expect(parseFurigana('日々[ひび]、背負[しょ]い込[こ]ん')).toEqual([
      { base: '日々', rt: 'ひび' },
      { base: '、', rt: '' },
      { base: '背負', rt: 'しょ' },
      { base: 'い', rt: '' },
      { base: '込', rt: 'こ' },
      { base: 'ん', rt: '' },
    ])
  })

  test('drops stray brackets and passes Latin text through', () => {
    expect(parseFurigana('By my side[x] ね')).toEqual([
      { base: 'By my side ね', rt: '' },
    ])
  })
})
