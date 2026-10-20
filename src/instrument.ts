import * as Sentry from '@sentry/react'

import { BE_ADDRESS, LOOKUP_ADDRESS } from '@/lib/synbox-flask/address'

// No DSN (local runs without one) leaves the SDK disabled
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  integrations: [
    // Sentry has no React Router 8 integration yet, so transactions are named by URL
    Sentry.browserTracingIntegration(),
  ],
  replaysOnErrorSampleRate: 1,
  // The free plan includes 50 replays a month; spend them on sessions that hit an error
  replaysSessionSampleRate: 0,
  tracePropagationTargets: [BE_ADDRESS, LOOKUP_ADDRESS],
  tracesSampleRate: 1,
})

// Replay is 120 KiB of the first bundle; Sentry's CDN serves it once the page has loaded instead. Its error
// replays then start recording a moment later, and an error before that has no replay
const addReplay = async () => {
  try {
    const replayIntegration =
      await Sentry.lazyLoadIntegration('replayIntegration')
    Sentry.addIntegration(
      replayIntegration({ blockAllMedia: true, maskAllText: true })
    )
  } catch (error) {
    console.warn('Sentry replay did not load', error)
  }
}

if (Sentry.getClient()?.getDsn() !== undefined) {
  window.addEventListener(
    'load',
    () => {
      void addReplay()
    },
    { once: true }
  )
}
