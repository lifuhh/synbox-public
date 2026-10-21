import { describe, expect, test } from 'vite-plus/test'

import {
  glideMs,
  homeIndex,
  loopCopies,
  releaseTarget,
} from './carousel-motion'

const release = (position: number, velocity: number, momentum = true) =>
  releaseTarget({ from: 40, maxTravel: 31, momentum, position, velocity })

describe('releaseTarget', () => {
  // A 300px slide: a gentle 0.3 px/ms swipe and a hard 4 px/ms flick
  test('a hard flick travels several slides, a gentle swipe one', () => {
    expect(release(40.3, 4 / 300)).toBe(47)
    expect(release(40.15, 0.3 / 300)).toBe(41)
  })

  test('a slow drag past the commit distance still moves one slide, either way', () => {
    expect(release(40.12, 0)).toBe(41)
    expect(release(39.88, 0)).toBe(39)
    expect(release(40.05, 0)).toBe(40)
  })

  test('a drag back against its own flick lands where the flick points', () => {
    expect(release(41.2, -1.5 / 300)).toBe(39)
  })

  test('a flick never runs past the clones', () => {
    expect(release(40.5, 40 / 300)).toBe(71)
  })

  test('reduced motion moves at most one slide', () => {
    expect(release(40.3, 4 / 300, false)).toBe(41)
  })
})

describe('loop', () => {
  test('a short list gets more copies so a flick cannot reach the end', () => {
    expect(loopCopies(32, 16)).toBe(3)
    expect(loopCopies(5, 16)).toBe(9)
    expect(loopCopies(1, 16)).toBe(1)
  })

  test('homeIndex maps any copy of a slide, and negatives, into the middle copy', () => {
    expect(homeIndex(3, 32, 3)).toBe(35)
    expect(homeIndex(70, 32, 3)).toBe(38)
    expect(homeIndex(-1, 32, 3)).toBe(63)
  })
})

describe('glideMs', () => {
  test('a fast release glides at the finger speed; slow or reversed releases take the step time', () => {
    expect(glideMs(1200, 4)).toBe(900)
    expect(glideMs(600, 4)).toBe(450)
    expect(glideMs(300, 0.1)).toBe(320)
    expect(glideMs(300, -2)).toBe(320)
  })
})
