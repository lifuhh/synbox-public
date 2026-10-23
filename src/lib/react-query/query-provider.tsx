import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from '@tanstack/react-query'
import type { ReactNode } from 'react'

// "The app came to the front": the tab becoming visible (React Query's only signal by default) or the window taking
// focus. Side-by-side windows never hide the tab, so returning to one only fires `focus`. Stale queries refetch then,
// and src/lib/library and src/lib/prefs sync on the same signal. A blur also leaves for the YouTube iframe, so
// clicking back from the video counts as a return too; that costs one refetch of whatever is stale
focusManager.setEventListener((setFocused) => {
  const onVisibility = () => {
    setFocused(document.visibilityState === 'visible')
  }
  const onFocus = () => {
    setFocused(true)
  }
  const onBlur = () => {
    setFocused(false)
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', onFocus)
  window.addEventListener('blur', onBlur)
  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('blur', onBlur)
  }
})

const queryClient = new QueryClient()

export const QueryProvider = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)
