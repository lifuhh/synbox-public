import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { streamAnnotateVideoById } from '@/lib/synbox-flask/api'

// The backend wrote the lyrics itself; a regeneration also names the version it saved
export interface PersistedLyrics {
  version: number | null
}

interface AnnotationMutationVariables {
  vidId: string
  lyrics: string[]
  timestampedLyrics: unknown[]
}

export const useStreamAnnotateApi = () => {
  const [isStreaming, setIsStreaming] = useState(false)
  const [isDataComplete, setIsDataComplete] = useState(false)
  const [updateMessages, setUpdateMessages] = useState<string[]>([])
  const [engTranslation, setEngTranslation] = useState<string[] | null>(null)
  const [chiTranslation, setChiTranslation] = useState<string[] | null>(null)
  const [romajiLyrics, setRomajiLyrics] = useState<string[] | null>(null)
  const [kanjiAnnotations, setKanjiAnnotations] = useState<string[] | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
  const [currentTask, setCurrentTask] = useState<string | null>(null)
  const [persisted, setPersisted] = useState<PersistedLyrics | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const streamTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const retryCountRef = useRef(0)
  const currentRequestRef = useRef<AnnotationMutationVariables | null>(null)
  const mutateRef = useRef<
    ((params: AnnotationMutationVariables) => void) | null
  >(null)

  const MAX_RETRIES = 3
  const STREAM_TIMEOUT = 300_000

  const resetStream = useCallback(() => {
    setIsStreaming(false)
    setIsDataComplete(false)
    setUpdateMessages([])
    setEngTranslation(null)
    setChiTranslation(null)
    setRomajiLyrics(null)
    setKanjiAnnotations(null)
    setError(null)
    setCurrentTask(null)
    setPersisted(null)
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
    // Otherwise the idle timer fires later and silently retries the request
    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current)
      streamTimeoutRef.current = null
    }
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
      vidId,
      lyrics,
      timestampedLyrics,
    }: AnnotationMutationVariables) => {
      resetStream()
      currentRequestRef.current = { vidId, lyrics, timestampedLyrics }
      setIsStreaming(true)

      abortControllerRef.current = new AbortController()
      startStreamTimeout()

      try {
        await streamAnnotateVideoById(
          vidId,
          lyrics,
          timestampedLyrics,
          (message) => {
            setUpdateMessages((prev) => [...prev, message])
          },
          (type, lines) => {
            const setters = {
              chi_translation: setChiTranslation,
              eng_translation: setEngTranslation,
              kanji_annotations: setKanjiAnnotations,
              romaji_lyrics: setRomajiLyrics,
            }
            setters[type](lines)
            if (streamTimeoutRef.current) {
              clearTimeout(streamTimeoutRef.current)
            }
          },
          (err) => {
            console.error('Stream error:', err)
            handleError(err)
          },
          (task) => {
            setCurrentTask(task)
          },
          (version) => {
            setPersisted({ version })
          },
          abortControllerRef.current.signal
        )
      } catch (err) {
        if (!(err instanceof Error && err.name === 'AbortError')) {
          console.error('Mutation error:', err)
          handleError(err)
        }
        throw err
      } finally {
        setIsDataComplete(true)
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
    isDataComplete,
    updateMessages,
    engTranslation,
    chiTranslation,
    romajiLyrics,
    kanjiAnnotations,
    error,
    currentTask,
    persisted,
    resetStream,
    mutate: mutation.mutate,
  }
}
