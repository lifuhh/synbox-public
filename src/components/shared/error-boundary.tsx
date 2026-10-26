import type { ReactNode } from 'react'
import { Component } from 'react'

import TopBar from '@/components/shared/top-bar'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

const handleReload = () => {
  window.location.reload()
}

const handleReturnHome = () => {
  window.location.href = '/'
}

class ErrorBoundary extends Component<Props, State> {
  public constructor(props: Props) {
    super(props)
    this.state = {
      error: null,
      hasError: false,
    }
  }

  public static getDerivedStateFromError(error: Error): State {
    return { error, hasError: true }
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className='relative h-(--app-h) w-full'>
          <TopBar />
          <div className='relative -my-14 flex min-h-(--app-h) flex-col items-center justify-center bg-background px-4 py-12 sm:px-6 lg:px-8'>
            <div className='mx-auto max-w-md text-center'>
              <h1 className='text-3xl font-bold tracking-tight text-balance text-foreground sm:text-4xl'>
                This Page Crashed
              </h1>
              <p className='mt-4 leading-normal text-muted-foreground'>
                Reload to try again
              </p>
              {/* Quieter than the way out, for a report */}
              {this.state.error && (
                <p className='mt-2 text-xs leading-normal break-words text-faint'>
                  {this.state.error.toString()}
                </p>
              )}
              <div className='mt-6 flex justify-center gap-3'>
                <Button onClick={handleReload}>Reload</Button>
                <Button variant='outline' onClick={handleReturnHome}>
                  Go Home
                </Button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
