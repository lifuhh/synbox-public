import { describe, expect, test } from 'vite-plus/test'

import { phonePosture } from './phone-posture'

const at = (deg: number, g = 9.81) => {
  const rad = (deg * Math.PI) / 180
  return phonePosture(g * Math.sin(rad), g * Math.cos(rad))
}

describe('phonePosture', () => {
  test('either end down is upright, either side edge down is sideways', () => {
    expect(phonePosture(0.3, 9.7)).toBe('upright')
    expect(phonePosture(-0.3, -9.7)).toBe('upright')
    expect(phonePosture(9.7, 0.4)).toBe('sideways')
    expect(phonePosture(-9.7, -0.4)).toBe('sideways')
  })

  test('the tilt between the two is neither, so a wobble near 45 degrees never switches', () => {
    expect(at(29)).toBe('upright')
    expect(at(45)).toBeNull()
    expect(at(59)).toBeNull()
    expect(at(61)).toBe('sideways')
  })

  test('lying flat, or no reading, tells nothing', () => {
    expect(phonePosture(0.5, 1.2)).toBeNull()
    expect(phonePosture(null, 9.8)).toBeNull()
    expect(phonePosture(undefined, undefined)).toBeNull()
  })
})
