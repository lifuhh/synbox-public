import { expect, test } from 'vite-plus/test'

import { formatStamp } from '@/utils'

test('a notification time is day first, 24-hour, every part two digits', () => {
  expect(formatStamp(new Date(2026, 0, 5, 7, 3).getTime())).toBe(
    '05/01/26 07:03'
  )
  expect(formatStamp(new Date(2026, 11, 31, 23, 59).getTime())).toBe(
    '31/12/26 23:59'
  )
})
