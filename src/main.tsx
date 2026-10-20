import './instrument'
import { reactErrorHandler } from '@sentry/react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'

import App from './App'
import ErrorBoundary from './components/shared/ErrorBoundary'
import AppProvider from './context/AppContext'
import { QueryProvider } from './lib/react-query/QueryProvider'

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
