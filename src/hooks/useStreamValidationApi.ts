import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { streamValidateVideoById } from '@/lib/synbox-flask/api'
import type { VideoInfo } from '@/types'

export const useStreamValidationApi = () => {
  const [isStreaming, setIsStreaming] = useState(false)
  const [updateMessages, setUpdateMessages] = useState<string[]>([])
  const [vidInfo, setVidInfo] = useState<VideoInfo | null>(null)
  const [showVidInfo, setShowVidInfo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const streamTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const retryCountRef = useRef(0)
  const currentIdRef = useRef<string | null>(null)
  const mutateRef = useRef<((id: string) => void) | null>(null)

  const MAX_RETRIES = 3
  const STREAM_TIMEOUT = 30_000

  const resetStream = useCallback(() => {
    setIsStreaming(false)
    setUpdateMessages([])
    setVidInfo(null)
    setShowVidInfo(false)
    setError(null)
    retryCountRef.current = 0

    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current)
      streamTimeoutRef.current = null
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  const handleError = useCallback((err: unknown) => {
    console.error('Stream error:', err)
    if (err instanceof Error) {
      setError(err.message)
    } else if (typeof err === 'string') {
      setError(err)
    } else {
      setError('An unknown error occurred')
    }
    setIsStreaming(false)
  }, [])

  const handleVideoInfo = useCallback(
    (info: unknown) => {
      try {
        if (!info || typeof info !== 'object') {
          throw new Error('Invalid video info format')
        }
        setVidInfo(info as VideoInfo)

        if (streamTimeoutRef.current) {
          clearTimeout(streamTimeoutRef.current)
        }
      } catch (err) {
        console.error('Error processing video info:', err)
        handleError(err)
      }
    },
    [handleError]
  )

  const startStreamTimeout = useCallback(() => {
    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current)
    }

    streamTimeoutRef.current = setTimeout(() => {
      console.warn('Stream timeout reached')
      if (
        retryCountRef.current < MAX_RETRIES &&
        currentIdRef.current &&
        mutateRef.current
      ) {
        retryCountRef.current++
        mutateRef.current(currentIdRef.current)
      } else {
        handleError('Stream timeout reached after multiple retries')
      }
    }, STREAM_TIMEOUT)
  }, [handleError])

  const mutation = useMutation({
    mutationFn: async (id: string) => {
      resetStream()
      currentIdRef.current = id
      setIsStreaming(true)

      abortControllerRef.current = new AbortController()
      startStreamTimeout()

      try {
        await streamValidateVideoById(
          id,
          (message) => {
            setUpdateMessages((prev) => [...prev, message])
          },
          (info) => {
            handleVideoInfo(info)
          },
          (err) => {
            console.error('Stream error:', err)
            handleError(err)
          },
          () => {
            if (streamTimeoutRef.current) {
              clearTimeout(streamTimeoutRef.current)
            }
            setIsStreaming(false)
          },
          abortControllerRef.current.signal
        )
      } catch (err) {
        if (!(err instanceof Error && err.name === 'AbortError')) {
          console.error('Mutation error:', err)
          handleError(err)
        }
        throw err
      }
    },
    onError: (err: unknown) => {
      console.error('Mutation error:', err)
      handleError(err)
    },
  })

  useEffect(() => {
    mutateRef.current = mutation.mutate
  }, [mutation.mutate])

  useEffect(
    () => () => {
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current)
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    },
    []
  )

  return {
    isStreaming,
    updateMessages,
    vidInfo,
    showVidInfo,
    setShowVidInfo,
    error,
    resetStream,
    mutate: mutation.mutate,
  }
}
