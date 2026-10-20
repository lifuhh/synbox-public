import './instrument'
import { reactErrorHandler } from '@sentry/react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'

import App from './app'
import ErrorBoundary from './components/shared/error-boundary'
import AppProvider from './context/app-context'
import { QueryProvider } from './lib/react-query/query-provider'

const rootElement = document.querySelector('#root')
if (rootElement === null) {
  throw new Error('Missing #root element in index.html')
}

ReactDOM.createRoot(rootElement, {
  onCaughtError: reactErrorHandler(),
  onRecoverableError: reactErrorHandler(),
  onUncaughtError: reactErrorHandler(),
}).render(
  <BrowserRouter>
    <AppProvider>
      <QueryProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </QueryProvider>
    </AppProvider>
  </BrowserRouter>
)
