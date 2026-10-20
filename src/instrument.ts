import * as Sentry from '@sentry/react'

import { BE_ADDRESS, LOOKUP_ADDRESS } from '@/lib/synbox-flask/address'

// No DSN (local runs without one) leaves the SDK disabled
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  integrations: [
    // Sentry has no React Router 8 integration yet, so transactions are named by URL
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({ blockAllMedia: true, maskAllText: true }),
  ],
  replaysOnErrorSampleRate: 1,
  // The free plan includes 50 replays a month; spend them on sessions that hit an error
  replaysSessionSampleRate: 0,
  tracePropagationTargets: [BE_ADDRESS, LOOKUP_ADDRESS],
  tracesSampleRate: 1,
})
