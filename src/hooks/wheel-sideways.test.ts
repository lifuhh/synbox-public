import { describe, expect, test } from 'vite-plus/test'

import { mouseNotches } from './wheel-sideways'

// The values each engine gives a wheel event, worked out from its source. Chromium on Windows, one mouse notch:
// delta = 100 × lines / 3 px, ticks = 1; display scaling multiplies both and window.devicePixelRatio divides it out
// again, page zoom divides both (wheelDeltaY truncated to an integer)
const windowsNotch = (zoom: number, lines = 3, fraction = 1) => ({
  deltaMode: 0,
  deltaY: (fraction * lines * (100 / 3)) / zoom,
  wheelDeltaY: -Math.trunc((fraction * 120) / zoom),
})
// A precise scroll: wheelDeltaY is deltaY truncated, times 1 (Windows, Linux) or 3 (macOS)
const precise = (deltaY: number, times: 1 | 3) => ({
  deltaMode: 0,
  deltaY,
  wheelDeltaY: -Math.trunc(times * deltaY),
})

describe('mouseNotches', () => {
  test('a Windows mouse is a notch at any page zoom and display scaling', () => {
    // 100% zoom, at 100%, 125% or 150% display scaling alike
    expect(mouseNotches(windowsNotch(1))).toBe(1)
    // Page zoom: wheelDeltaY 96, 109, 80, 133 (not multiples of 120: the rule this replaces missed them)
    for (const zoom of [1.25, 1.1, 1.5, 0.9, 0.67, 2, 3]) {
      expect(mouseNotches(windowsNotch(zoom))).toBeGreaterThan(0)
    }
    // "Lines to scroll" 1 and 5: deltaY 33.3 and 166.7 for wheelDeltaY 120
    expect(mouseNotches(windowsNotch(1, 1))).toBe(1)
    expect(mouseNotches(windowsNotch(1.25, 5))).toBeGreaterThan(0)
    // "One screen at a time": page mode
    expect(mouseNotches({ deltaMode: 2, deltaY: 1, wheelDeltaY: -120 })).toBe(1)
  })

  test('a high-resolution wheel counts its fractions of a notch', () => {
    expect(mouseNotches(windowsNotch(1, 3, 1 / 8))).toBe(1 / 8)
    expect(mouseNotches(windowsNotch(1.25, 3, 1 / 4))).toBeGreaterThan(0)
  })

  test('other engines: Firefox lines, a macOS Chrome mouse, a Linux mouse', () => {
    expect(mouseNotches({ deltaMode: 1, deltaY: 3, wheelDeltaY: -120 })).toBe(1)
    expect(
      mouseNotches({ deltaMode: 0, deltaY: 4.000244140625, wheelDeltaY: -120 })
    ).toBe(1)
    expect(mouseNotches({ deltaMode: 0, deltaY: 120, wheelDeltaY: -120 })).toBe(
      1
    )
  })

  test('a trackpad stays native: Windows precision touchpad and macOS, at any zoom', () => {
    for (const deltaY of [1, 2, 7, 23, 53.333, 2.4, 119.6, 200.5]) {
      expect(mouseNotches(precise(deltaY, 1))).toBe(0)
    }
    for (const deltaY of [1, 4, 13, 40, 3.6364, 80, 166.25]) {
      expect(mouseNotches(precise(deltaY, 3))).toBe(0)
    }
    // No legacy field: nothing to tell by, so native
    expect(mouseNotches({ deltaMode: 0, deltaY: 100 })).toBe(0)
  })
})
