import { expect, test } from 'vite-plus/test'

import { outsideOf, overBlock, upperLineFloor } from './two-line-layout'

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

// The block (the rows and the docked translation's place) from 100 to 200 on a stage whose translation tops may run
// from 0 to 370; the translation 30 tall; 10 kept between them
const block = { bottom: 200, top: 100 }
const room = { bottom: 370, top: 0 }

test('a translation asked to stand clear of the block stands there', () => {
  expect(outsideOf(210, 30, block, room, 10)).toBe(210)
  expect(outsideOf(60, 30, block, room, 10)).toBe(60)
})

test('a translation asked into the block goes just past it on the nearer side', () => {
  expect(outsideOf(185, 30, block, room, 10)).toBe(210)
  expect(outsideOf(90, 30, block, room, 10)).toBe(60)
})

test('with no room past the block on the nearer side it goes to the other side', () => {
  expect(outsideOf(185, 30, block, { bottom: 205, top: 0 }, 10)).toBe(60)
})

test('with no room on either side there is nowhere for it', () => {
  expect(outsideOf(150, 30, block, { bottom: 205, top: 65 }, 10)).toBeNull()
})

test('a translation asked past the stage stops at its edge', () => {
  expect(outsideOf(900, 30, block, room, 10)).toBe(370)
})

test('over the block means its centre is inside the block', () => {
  expect(overBlock(80, 30, block)).toBe(false)
  expect(overBlock(90, 30, block)).toBe(true)
  expect(overBlock(186, 30, block)).toBe(false)
})
