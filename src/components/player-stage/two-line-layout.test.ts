import { expect, test } from 'vite-plus/test'

import { upperLineFloor } from './two-line-layout'

// A one-row pair is 60px tall; the rows' gap is 10px
const home = 70
const gap = 10
const pair = (left: number, right: number) => [
  { bottom: 0, left, right, top: 24 },
  { bottom: 28, left, right, top: 60 },
]

test('a one-row lower line leaves the upper line at home', () => {
  expect(
    upperLineFloor({ gap, home, lower: pair(200, 750), upper: pair(0, 550) })
  ).toBe(home)
})

test('a lower line that wraps taller lifts the upper line only by what reaches into it', () => {
  const lower = [
    { bottom: 0, left: 200, right: 750, top: 24 },
    { bottom: 28, left: 200, right: 750, top: 100 },
  ]
  expect(upperLineFloor({ gap, home, lower, upper: pair(0, 550) })).toBe(110)
})

test('a taller lower line beside the upper line, sharing none of its width, moves nothing', () => {
  const lower = [
    { bottom: 0, left: 600, right: 750, top: 24 },
    { bottom: 28, left: 600, right: 750, top: 100 },
  ]
  expect(upperLineFloor({ gap, home, lower, upper: pair(0, 550) })).toBe(home)
})

test("the upper line's romaji clears the lower line's Japanese even when its own Japanese is narrower", () => {
  const lower = [
    { bottom: 0, left: 200, right: 750, top: 24 },
    { bottom: 28, left: 520, right: 750, top: 90 },
  ]
  const upper = [
    { bottom: 0, left: 0, right: 560, top: 24 },
    { bottom: 28, left: 0, right: 300, top: 60 },
  ]
  expect(upperLineFloor({ gap, home, lower, upper })).toBe(100)
})
