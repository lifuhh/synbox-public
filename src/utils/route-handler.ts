import type { NavigateFunction } from 'react-router'

interface VideoRouteConfig {
  navigate: NavigateFunction
  videoId: string | undefined
  setIsLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setStateVideoId: (videoId: string | null) => void
  onSuccess?: () => void
}

export const handleVideoRoute = async ({
  navigate,
  videoId,
  setIsLoading,
  setError,
  setStateVideoId,
  onSuccess,
}: VideoRouteConfig): Promise<void> => {
  if (videoId === undefined || videoId === '') {
    await navigate('/', { replace: true })
    return
  }

  try {
    setIsLoading(true)
    setError(null)

    if (!/^[a-zA-Z0-9_-]{11}$/u.test(videoId)) {
      throw new Error('Invalid video ID format')
    }

    setStateVideoId(videoId)
    onSuccess?.()
  } catch (error) {
    console.error('Error processing video route:', error)
    setError(error instanceof Error ? error.message : 'Failed to load video')
    setStateVideoId(null)
  } finally {
    setIsLoading(false)
  }
}

export const isValidVideoId = (id: string): boolean =>
  /^[a-zA-Z0-9_-]{11}$/u.test(id)
