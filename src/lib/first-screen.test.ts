// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vite-plus/test'

import { firstScreenIn } from './first-screen'

afterEach(() => {
  vi.useRealTimers()
})

// On the live site `load` came before the app's first render: the page still held index.html's static copy, nothing
// on it was loading, and everything that waits for the first screen started at once
test('index.html’s static page is not a first screen', async () => {
  vi.useFakeTimers()
  document.body.innerHTML =
    '<div id="root"><main id="static-home"><h1>Synbox</h1></main></div>'
  let isIn = false
  void (async () => {
    await firstScreenIn()
    isIn = true
  })()

  await vi.advanceTimersByTimeAsync(10_000)
  expect(isIn).toBe(false)

  // The app draws its page, with nothing left to load
  document.body.innerHTML = '<div id="root"><main><h1>Synbox</h1></main></div>'
  await vi.advanceTimersByTimeAsync(2000)
  expect(isIn).toBe(true)
})
