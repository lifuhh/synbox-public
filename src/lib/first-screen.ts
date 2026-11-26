// Background downloads (other pages' code, the gallery's fonts, the app shell's offline copy, error replays) wait
// for the first screen. Started on a timer instead, they shared a slow connection with the lists and pictures the
// visitor was waiting for: on slow 4G the gallery's fonts began with the first thumbnails, which then finished at a
// median of 17 s

// Not before this long after the page began loading, however fast the first screen came
const OPENING_MS = 4000
const POLL_MS = 500
// Stops asking after 30 s: something on screen that never finishes loading must not hold the rest back for good
const MAX_POLLS = 60

const wait = async (ms: number) => {
  // oxlint-disable-next-line promise/avoid-new -- turns setTimeout into a promise
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

const pageLoaded = async () => {
  if (document.readyState === 'complete') {
    return
  }
  // oxlint-disable-next-line promise/avoid-new -- turns the load event into a promise
  await new Promise<void>((resolve) => {
    window.addEventListener(
      'load',
      () => {
        resolve()
      },
      { once: true }
    )
  })
}

// Whether a placeholder or a picture still loading is on screen. An IntersectionObserver, not their boxes: it
// leaves out what a scrolling list clips, whose lazy pictures never start
const loadingOnScreen = async () => {
  const loading = [
    ...document.querySelectorAll('[data-slot="skeleton"]'),
    ...[...document.images].filter((image) => !image.complete),
  ]
  if (loading.length === 0) {
    return false
  }
  // oxlint-disable-next-line promise/avoid-new -- turns the observer's first report into a promise
  return await new Promise<boolean>((resolve) => {
    const observer = new IntersectionObserver((entries) => {
      observer.disconnect()
      resolve(entries.some((entry) => entry.isIntersecting))
    })
    for (const element of loading) {
      observer.observe(element)
    }
  })
}

const settle = async () => {
  await pageLoaded()
  await wait(Math.max(0, OPENING_MS - performance.now()))
  for (let polls = 0; polls < MAX_POLLS; polls += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one look at a time, half a second apart
    if (!(await loadingOnScreen())) {
      return
    }
    // oxlint-disable-next-line no-await-in-loop
    await wait(POLL_MS)
  }
}

let settled: Promise<void> | undefined

// Resolves once the page has loaded and nothing on screen is still loading; at once on every later call
export const firstScreenIn = async () => {
  settled ??= settle()
  await settled
}
