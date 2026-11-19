import { expect, test } from 'vite-plus/test'

import { matchesQuery } from './text-search'

test('every word matches some field, in any order, width, case or kana', () => {
  const row = ['アイドル', 'YOASOBI', 'fan.mail@example.com', 'ZRtdQ81jPUQ']
  expect(matchesQuery('あいどる yoasobi', row)).toBe(true)
  expect(matchesQuery('ＹＯＡＳＯＢＩ ｱｲﾄﾞﾙ', row)).toBe(true)
  expect(matchesQuery('example.com', row)).toBe(true)
  expect(matchesQuery('zrtdq81', row)).toBe(true)
  // Both words must be there
  expect(matchesQuery('yoasobi lemon', row)).toBe(false)
  expect(matchesQuery('   ', row)).toBe(true)
})
