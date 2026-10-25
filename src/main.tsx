import './instrument'
import { reactErrorHandler } from '@sentry/react'
import { MotionConfig } from 'motion/react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'

import App from './app'
import ErrorBoundary from './components/shared/error-boundary'
import { QueryProvider } from './lib/react-query/query-provider'
import { trackAppOpenLater } from './lib/usage-later'

const rootElement = document.querySelector('#root')
if (rootElement === null) {
  throw new Error('Missing #root element in index.html')
}

ReactDOM.createRoot(rootElement, {
  onCaughtError: reactErrorHandler((caught: unknown, errorInfo) => {
    console.error('Uncaught error:', caught, errorInfo)
  }),
  onRecoverableError: reactErrorHandler(),
  onUncaughtError: reactErrorHandler(),
}).render(
  <BrowserRouter>
    <QueryProvider>
      <ErrorBoundary>
        {/* Reduce Motion on the device keeps motion's fades and drops its moves and scales */}
        <MotionConfig reducedMotion='user'>
          <App />
        </MotionConfig>
      </ErrorBoundary>
    </QueryProvider>
  </BrowserRouter>
)

// How the app was opened, for its owner (lib/usage.ts); loaded after the first render, so the first load doesn't
// carry it
trackAppOpenLater()
