import './polyfills'
import './instrument'
import { reactErrorHandler } from '@sentry/react'
import { MotionConfig } from 'motion/react'
import ReactDOM from 'react-dom/client'

import App from './app'
import ErrorBoundary from './components/shared/error-boundary'
import { trackInputModality } from './lib/input-modality'
import AppRouter from './lib/nav/app-router'
import { lastDataRestored } from './lib/react-query/query-client'
import { QueryProvider } from './lib/react-query/query-provider'
import { trackAppOpenLater } from './lib/usage-later'
import { trackZoom } from './lib/zoom'

trackInputModality()
trackZoom()

const rootElement = document.querySelector('#root')
if (rootElement === null) {
  throw new Error('Missing #root element in index.html')
}

const root = ReactDOM.createRoot(rootElement, {
  onCaughtError: reactErrorHandler((caught: unknown, errorInfo) => {
    console.error('Uncaught error:', caught, errorInfo)
  }),
  onRecoverableError: reactErrorHandler(),
  onUncaughtError: reactErrorHandler(),
})

// The first render waits (150ms at most) for the lists kept from the last visit, so the app opens on them instead
// of drawing placeholders first; index.html's static page shows until then
// (not a top-level await: that splits the first load into a chunk per shared module)
const start = async () => {
  await lastDataRestored()
  root.render(
    <AppRouter>
      <QueryProvider>
        <ErrorBoundary>
          {/* Reduce Motion on the device keeps motion's fades and drops its moves and scales */}
          <MotionConfig reducedMotion='user'>
            <App />
          </MotionConfig>
        </ErrorBoundary>
      </QueryProvider>
    </AppRouter>
  )
  // How the app was opened, for its owner (lib/usage.ts); loaded after the first render, so the first load doesn't
  // carry it
  trackAppOpenLater()
}
void start()
