import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'

import App from './App'
import AppProvider from './context/AppContext'
import { QueryProvider } from './lib/react-query/QueryProvider'
import ErrorBoundary from './test_stuff/ErrorBoundary'

ReactDOM.createRoot(document.getElementById('root')!).render(
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
