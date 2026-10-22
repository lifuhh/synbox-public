import { expect, test } from 'vite-plus/test'

import { spaceDashes } from '@/utils'

test('a dash between two words gets a space each side, whichever dash was written', () => {
  expect(spaceDashes('It was late—we kept on walking')).toBe(
    'It was late — we kept on walking'
  )
  expect(spaceDashes('It was late–we kept on walking')).toBe(
    'It was late — we kept on walking'
  )
  expect(spaceDashes('It was late--we kept on walking')).toBe(
    'It was late — we kept on walking'
  )
  expect(spaceDashes('It was late —we kept on walking')).toBe(
    'It was late — we kept on walking'
  )
  expect(spaceDashes('It was late——we kept on walking')).toBe(
    'It was late — we kept on walking'
  )
  // Already spaced: unchanged
  expect(spaceDashes('It was late — we kept on walking')).toBe(
    'It was late — we kept on walking'
  )
  expect(spaceDashes('one—two—three')).toBe('one — two — three')
})

test('hyphenated words, number ranges and a dash at either end stay as written', () => {
  expect(spaceDashes('a well-known road')).toBe('a well-known road')
  expect(spaceDashes('pages 1–2')).toBe('pages 1–2')
  expect(spaceDashes('I was—')).toBe('I was—')
  expect(spaceDashes('—and then')).toBe('—and then')
  expect(spaceDashes('')).toBe('')
})
