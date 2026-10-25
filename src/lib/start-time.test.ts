import { describe, expect, test } from 'vite-plus/test'

import { parseStartTime } from './start-time'

describe('parseStartTime', () => {
  test('reads every way YouTube writes a start', () => {
    expect(parseStartTime('250')).toBe(250)
    expect(parseStartTime('250s')).toBe(250)
    expect(parseStartTime('4m10s')).toBe(250)
    expect(parseStartTime('1h2m3s')).toBe(3723)
    expect(parseStartTime('4:10')).toBe(250)
    expect(parseStartTime('1:02:03')).toBe(3723)
    expect(parseStartTime('2:45.4')).toBeCloseTo(165.4)
  })

  test('anything else starts from the top', () => {
    expect(parseStartTime(null)).toBeNull()
    expect(parseStartTime('')).toBeNull()
    expect(parseStartTime('0')).toBeNull()
    expect(parseStartTime('abc')).toBeNull()
    expect(parseStartTime('4:7')).toBeNull()
    expect(parseStartTime('-5')).toBeNull()
  })
})
