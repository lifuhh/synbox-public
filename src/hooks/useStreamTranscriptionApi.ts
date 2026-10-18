import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { streamTranscribeVideoById } from '@/lib/synbox-flask/api'
import type { SubtitleInfo } from '@/types'

interface TranscriptionParams {
  id: string
  subtitleInfo: SubtitleInfo
  forceAiTranscription?: boolean
}

export const useStreamTranscriptionApi = () => {
  const [isStreaming, setIsStreaming] = useState(false)
  const [updateMessages, setUpdateMessages] = useState<string[]>([])
  const [lyricsInfo, setLyricsInfo] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [isAiGenerated, setIsAiGenerated] = useState(false)

  const abortControllerRef = useRef<AbortController | null>(null)
  const streamTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const retryCountRef = useRef(0)
  const currentRequestRef = useRef<TranscriptionParams | null>(null)
  const mutateRef = useRef<((params: TranscriptionParams) => void) | null>(null)

  const MAX_RETRIES = 3
  const STREAM_TIMEOUT = 300_000

  const resetStream = useCallback(() => {
    setIsStreaming(false)
    setUpdateMessages([])
    setLyricsInfo(null)
    setError(null)
    setIsAiGenerated(false)
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

  const startStreamTimeout = useCallback(() => {
    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current)
    }

    streamTimeoutRef.current = setTimeout(() => {
      console.warn('Stream timeout reached')
      if (
        retryCountRef.current < MAX_RETRIES &&
        currentRequestRef.current &&
        mutateRef.current
      ) {
        retryCountRef.current++
        mutateRef.current(currentRequestRef.current)
      } else {
        handleError('Stream timeout reached after multiple retries')
      }
    }, STREAM_TIMEOUT)
  }, [handleError])

  const mutation = useMutation({
    mutationFn: async ({
      id,
      subtitleInfo,
      forceAiTranscription,
    }: TranscriptionParams) => {
      resetStream()
      currentRequestRef.current = { id, subtitleInfo, forceAiTranscription }
      setIsStreaming(true)

      abortControllerRef.current = new AbortController()
      startStreamTimeout()

      try {
        await streamTranscribeVideoById(
          id,
          subtitleInfo,
          (message) => {
            setUpdateMessages((prev) => [...prev, message])
          },
          (info) => {
            setLyricsInfo(info)
            if (streamTimeoutRef.current) {
              clearTimeout(streamTimeoutRef.current)
            }
          },
          (err) => {
            console.error('Stream error:', err)
            handleError(err)
          },
          (aiGenerated) => {
            setIsAiGenerated(aiGenerated)
          },
          abortControllerRef.current.signal,
          forceAiTranscription
        )
      } catch (err) {
        if (!(err instanceof Error && err.name === 'AbortError')) {
          console.error('Mutation error:', err)
          handleError(err)
        }
        throw err
      } finally {
        setIsStreaming(false)
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
    lyricsInfo,
    error,
    isAiGenerated,
    resetStream,
    mutate: mutation.mutate,
  }
}
