import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'

import TopBar from '@/components/shared/TopBar'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo })
    console.error('Uncaught error:', error, errorInfo)
  }

  private readonly handleReturnHome = () => {
    window.location.href = '/'
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className='relative h-dvh w-full'>
          <TopBar />
          <div className='relative -my-14 flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12 sm:px-6 lg:px-8'>
            <div className='mx-auto max-w-md text-center'>
              <div className='mx-auto h-12 w-12 text-primary' />
              <h1 className='mt-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl'>
                Something Went Wrong
              </h1>
              <p className='mt-4 text-muted-foreground'>
                We're sorry — an unexpected error has occurred:
              </p>
              {this.state.error && (
                <p className='mt-2 text-muted-foreground'>
                  {this.state.error.toString()}
                </p>
              )}
              <div className='mt-6'>
                <Button onClick={this.handleReturnHome}>Return To Home</Button>
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
