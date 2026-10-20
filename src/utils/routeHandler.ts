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
    navigate('/', { replace: true })
    return
  }

  try {
    setIsLoading(true)
    setError(null)

    if (!/^[a-zA-Z0-9_-]{11}$/.exec(videoId)) {
      throw new Error('Invalid video ID format')
    }

    setStateVideoId(videoId)
    onSuccess?.()
  } catch (err) {
    console.error('Error processing video route:', err)
    setError(err instanceof Error ? err.message : 'Failed to load video')
    setStateVideoId(null)
  } finally {
    setIsLoading(false)
  }
}

export const isValidVideoId = (id: string): boolean =>
  /^[a-zA-Z0-9_-]{11}$/.test(id)
