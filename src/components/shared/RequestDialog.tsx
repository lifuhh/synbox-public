import { DialogDescription } from '@radix-ui/react-dialog'
import { useQueryClient } from '@tanstack/react-query'
import { useAtom } from 'jotai'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import {
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/use-toast'
import { dialogStepAtom } from '@/context/atoms'
import type { PersistedLyrics } from '@/hooks/useStreamAnnotateApi'
import { useStreamValidationApi } from '@/hooks/useStreamValidationApi'
import {
  useAddLyricsVersion,
  useGetLyricsBySongId,
  useUploadLyricsToAppwrite,
} from '@/lib/react-query/queriesAndMutations'
import { QUERY_KEYS } from '@/lib/react-query/queryKeys'

import { Button } from '../ui/button'
import RequestDialogAnnotateDisplay from './RequestDialogAnnotateDisplay'
import RequestDialogFinalDisplay from './RequestDialogFinalDisplay'
import RequestDialogStepTwoDisplay from './RequestDialogStepTwoDisplay'
import RequestDialogValidationDisplay from './RequestDialogValidationDisplay'
import UpdateMessagesDisplay from './UpdateMessagesDisplay'

interface RequestDialogProps {
  videoId: string
  handleClose: () => void
  // 'regenerate' saves the result as a new lyrics version; the song keeps showing its current one.
  mode?: 'new' | 'regenerate'
}

type OutsideEvent = CustomEvent<{ originalEvent: PointerEvent | FocusEvent }>

const RequestDialog = ({
  videoId,
  handleClose,
  mode = 'new',
}: RequestDialogProps) => {
  const [savedVersion, setSavedVersion] = useState<number | null>(null)
  const { mutate: addLyricsVersion } = useAddLyricsVersion()
  const [currentStep, setCurrentStep] = useAtom(dialogStepAtom)
  const [showLoader, setShowLoader] = useState(false)
  const [lyrics, setLyrics] = useState<string[]>([])
  const [annotateError, setAnnotateError] = useState<string | null>(null)
  const [timestampedLyrics, setTimestampedLyrics] = useState<unknown[]>([])
  const [engTranslation, setEngTranslation] = useState<string[]>([])
  const [chiTranslation, setChiTranslation] = useState<string[]>([])
  const [romajiLyrics, setRomajiLyrics] = useState<string[]>([])
  const [kanjiAnnotations, setKanjiAnnotations] = useState<string[]>([])
  const [persistedByBackend, setPersistedByBackend] =
    useState<PersistedLyrics | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const [isTranscriptionStreaming, setIsTranscriptionStreaming] =
    useState(false)
  const [isAnnotationStreaming, setIsAnnotationStreaming] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [forceAiTranscription, setForceAiTranscription] = useState(false)
  const {
    isStreaming,
    updateMessages,
    vidInfo,
    showVidInfo,
    setShowVidInfo,
    error,
    resetStream,
    mutate,
  } = useStreamValidationApi()

  const { toast } = useToast()

  const queryClient = useQueryClient()
  const { mutate: uploadLyricsToAppwrite } = useUploadLyricsToAppwrite()
  const { refetch: refetchLyrics } = useGetLyricsBySongId(videoId)

  const isButtonDisabled =
    isStreaming ||
    isUploading ||
    showLoader ||
    isAnnotationStreaming ||
    isTranscriptionStreaming

  const handleAnnotateError = (error: string) => {
    setAnnotateError(error)
  }

  const handleStreamingStatusChange = (status) => {
    setIsAnnotationStreaming(status)
  }

  const handleTranscriptionStreamingChange = (status: boolean) => {
    setIsTranscriptionStreaming(status)
  }

  useEffect(() => {
    if (videoId) {
      mutate(videoId)
    }
    return () => {
      resetStream()
    }
  }, [videoId, mutate, resetStream])

  useEffect(() => {
    if (isStreaming) {
      setShowLoader(true)
    } else {
      const timer = setTimeout(() => {
        setShowLoader(false)
      }, 1000)
      return () => {
        clearTimeout(timer)
      }
    }
  }, [isStreaming])

  useEffect(() => {
    if (vidInfo && !error) {
      const timer = setTimeout(() => {
        setShowVidInfo(true)
      }, 1000)
      return () => {
        clearTimeout(timer)
      }
    }
  }, [vidInfo, error, setShowVidInfo])

  const getDialogHeaderContent = () => {
    switch (currentStep) {
      case 0: {
        return { title: 'Step 1 - Validation', description: '' }
      }
      case 1: {
        return { title: 'Step 2 - Transcription', description: '' }
      }
      case 2: {
        return { title: 'Step 3 - Translation & Annotation', description: '' }
      }
      case 3: {
        return savedVersion === null
          ? { title: 'Upload Complete', description: 'Enjoy the video!' }
          : {
              description:
                'The current lyrics stay until you make this version the default.',
              title: `Saved as Version ${savedVersion}`,
            }
      }
      default: {
        return {
          title: 'Transcription Completed',
          description: 'Enjoy the video!',
        }
      }
    }
  }

  const { title, description } = getDialogHeaderContent()

  const handlePreviousClick = () => {
    setCurrentStep((prevStep) => Math.max(prevStep - 1, 0))
  }

  const handleLyricsUpdate = (
    newLyrics: string[],
    newTimestampedLyrics: unknown[]
  ) => {
    setLyrics(newLyrics)
    setTimestampedLyrics(newTimestampedLyrics)
  }

  const handleAnnotationsUpdate = (
    newEngTranslation: string[],
    newChiTranslation: string[],
    newRomajiLyrics: string[],
    newKanjiAnnotations: string[],
    persisted: PersistedLyrics | null
  ) => {
    setEngTranslation(newEngTranslation)
    setChiTranslation(newChiTranslation)
    setRomajiLyrics(newRomajiLyrics)
    setKanjiAnnotations(newKanjiAnnotations)
    setPersistedByBackend(persisted)
  }

  const refreshAfterUpload = async () => {
    await queryClient.invalidateQueries({
      queryKey: [QUERY_KEYS.GET_LYRICS_BY_SONG_ID, videoId],
    })
    await queryClient.invalidateQueries({
      queryKey: [QUERY_KEYS.SEARCH_VIDEOS],
    })
    await queryClient.invalidateQueries({
      queryKey: [QUERY_KEYS.SEARCH_LIBRARY],
    })
    await new Promise((resolve) => setTimeout(resolve, 5000))
    await refetchLyrics()
    setIsUploading(false)
    setUploadSuccess(true)
    setCurrentStep(3)
  }

  const handleUpload = async () => {
    setIsUploading(true)
    setUploadError(null)

    if (persistedByBackend?.version != null) {
      // A regeneration: the backend saved a new version and the song keeps its current lyrics
      await queryClient.invalidateQueries({
        queryKey: [QUERY_KEYS.GET_LYRICS_VERSIONS, videoId],
      })
      setSavedVersion(persistedByBackend.version)
      setIsUploading(false)
      setUploadSuccess(true)
      setCurrentStep(3)
      return
    }

    if (persistedByBackend) {
      try {
        // Song info and karaoke timing were written alongside the lyrics
        await queryClient.invalidateQueries({
          queryKey: [QUERY_KEYS.GET_SONG_INFO_BY_SONG_ID, videoId],
        })
        await queryClient.invalidateQueries({
          queryKey: [QUERY_KEYS.GET_KARAOKE_BY_ID, videoId],
        })
        await refreshAfterUpload()
      } catch (refreshError) {
        setIsUploading(false)
        setUploadError(
          `Refreshing the saved lyrics failed: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`
        )
      }
      return
    }

    if (!Array.isArray(timestampedLyrics) || timestampedLyrics.length === 0) {
      setUploadError('Timestamped lyrics are missing or invalid')
      setIsUploading(false)
      return
    }

    try {
      const formatTime = (seconds: number): string => {
        const pad = (num: number) => num.toString().padStart(2, '0')
        const roundedSeconds = Math.round(seconds * 1000) / 1000
        const hours = Math.floor(roundedSeconds / 3600)
        const minutes = Math.floor((roundedSeconds % 3600) / 60)
        const secs = Math.floor(roundedSeconds % 60)
        const milliseconds = Math.floor((roundedSeconds % 1) * 1000)
        return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${milliseconds.toString().padStart(3, '0')}`
      }

      const convertToRuby = (annotatedLine: string) => {
        const rubyLines = annotatedLine.replace(
          /([一-龯々]+)\[([^\]]+)\]/g,
          (match, kanji, reading) =>
            `<ruby>${kanji}<rp>(</rp><rt>${reading}</rt><rp>)</rp></ruby>`
        )
        return rubyLines.replace(/\[[^\]]+\]/g, '')
      }

      const adjustedTimestampedLyrics = timestampedLyrics.map(
        (item: any, index) => ({
          id: (index + 1).toString(),
          startTime: formatTime(item.start_time),
          startSeconds: item.start_time,
          endTime: formatTime(item.end_time),
          endSeconds: item.end_time,
          text: item.lyric,
        })
      )

      const labelledLyrics = adjustedTimestampedLyrics.map((item, index) => ({
        ...item,
        text: convertToRuby(kanjiAnnotations[index] || item.text),
      }))

      const lyricsData = {
        full_lyrics: JSON.stringify(adjustedTimestampedLyrics),
        plain_lyrics: JSON.stringify(lyrics),
        romaji: JSON.stringify(romajiLyrics),
        eng_translation: JSON.stringify(engTranslation),
        chi_translation: JSON.stringify(chiTranslation),
        labelled_full_lyrics: JSON.stringify(labelledLyrics),
      }

      if (mode === 'regenerate') {
        addLyricsVersion(
          { fields: lyricsData, videoId },
          {
            onError: (saveError: Error) => {
              setIsUploading(false)
              setUploadError(
                `Saving the new version failed: ${saveError.message}`
              )
            },
            onSuccess: async ({ version }) => {
              await queryClient.invalidateQueries({
                queryKey: [QUERY_KEYS.GET_LYRICS_VERSIONS, videoId],
              })
              setSavedVersion(version)
              setIsUploading(false)
              setUploadSuccess(true)
              setCurrentStep(3)
            },
          }
        )
        return
      }

      await uploadLyricsToAppwrite(
        { songId: videoId, lyricsData },
        {
          onSuccess: refreshAfterUpload,
          onError: (error: any) => {
            setIsUploading(false)
            setUploadError(`Upload failed: ${error.message}`)
            console.error('Upload failed:', error)
          },
        }
      )
    } catch (err: any) {
      setIsUploading(false)
      setUploadError(
        `An error occurred while processing the data: ${err.message}`
      )
      console.error('Error processing data:', err)
    }
  }

  const handleProceedClick = () => {
    if (currentStep === 2) {
      handleUpload()
    } else {
      setCurrentStep((prevStep) => prevStep + 1)
    }
  }

  const resetStates = () => {
    setCurrentStep(0)
    setShowLoader(false)
    setLyrics([])
    setAnnotateError(null)
    setTimestampedLyrics([])
    setEngTranslation([])
    setChiTranslation([])
    setRomajiLyrics([])
    setKanjiAnnotations([])
    setPersistedByBackend(null)
    setIsUploading(false)
    setUploadSuccess(false)
    setIsAnnotationStreaming(false)
    setUploadError(null)
    resetStream()
  }

  const handleCloseWithReset = () => {
    resetStates()
    handleClose()
    toast({
      description: 'Request Cancelled',
      duration: 2000,
    })
  }

  const handleEscapeKeyDown = (event: KeyboardEvent) => {
    event.preventDefault()
    if (!isButtonDisabled) {
      handleCloseWithReset()
    }
  }

  const handleOutsideEvent = (event: OutsideEvent) => {
    event.preventDefault()
    if (!isButtonDisabled) {
      handleCloseWithReset()
    }
  }

  const renderStep = () => {
    switch (currentStep) {
      case 0: {
        return (
          <>
            <UpdateMessagesDisplay
              isStreaming={isStreaming}
              showLoader={showLoader}
              updateMessages={updateMessages}
            />
            {showVidInfo && !showLoader && !error && vidInfo && (
              <RequestDialogValidationDisplay
                vidInfo={vidInfo}
                forceAiTranscription={forceAiTranscription}
                onForceAiChange={setForceAiTranscription}
              />
            )}
          </>
        )
      }
      case 1: {
        return (
          <RequestDialogStepTwoDisplay
            vidInfo={vidInfo}
            onLyricsUpdate={handleLyricsUpdate}
            onStreamingStatusChange={handleTranscriptionStreamingChange}
            forceAiTranscription={forceAiTranscription}
          />
        )
      }
      case 2: {
        // Stays mounted while uploading: remounting would start the annotation stream again
        return (
          <>
            {isUploading && (
              <UpdateMessagesDisplay
                isStreaming={true}
                showLoader={true}
                updateMessages={['Finalizing...']}
              />
            )}
            <div className={isUploading ? 'hidden' : undefined}>
              <RequestDialogAnnotateDisplay
                id={videoId}
                lyrics={lyrics}
                timestampedLyrics={timestampedLyrics}
                onAnnotationsUpdate={handleAnnotationsUpdate}
                onError={handleAnnotateError}
                onStreamingStatusChange={handleStreamingStatusChange}
              />
            </div>
          </>
        )
      }
      case 3: {
        if (savedVersion !== null) {
          return (
            <div className='flex flex-col gap-3 py-4'>
              <Button asChild>
                {/* Opened from the player, this link keeps the same page mounted, dialog included */}
                <Link
                  to={`/v/${videoId}?version=${savedVersion}`}
                  onClick={handleClose}>
                  Preview Version {savedVersion}
                </Link>
              </Button>
              <Button asChild variant='ghost'>
                <Link to={`/v/${videoId}/versions`} onClick={handleClose}>
                  Compare Versions
                </Link>
              </Button>
            </div>
          )
        }
        return vidInfo && <RequestDialogFinalDisplay vidInfo={vidInfo} />
      }
      default: {
        return null
      }
    }
  }

  return (
    <DialogContent
      className='flex h-auto max-h-[90vh] flex-col border border-accent bg-card invisible-ring sm:max-w-2xl [&>button]:hidden'
      onEscapeKeyDown={handleEscapeKeyDown}
      onPointerDownOutside={handleOutsideEvent}
      onInteractOutside={handleOutsideEvent}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <div className='mx-4 mt-2 grow overflow-y-auto'>
        {renderStep()}
        {(error || annotateError || uploadError) && (
          <div className='mt-4 text-destructive'>
            <h3 className='text-xl font-bold'>Error</h3>
            <p>{error || annotateError || uploadError}</p>
          </div>
        )}
      </div>

      {currentStep !== 3 && (
        <DialogFooter className='flex w-full flex-col-reverse gap-4 p-4 md:flex-row md:justify-between'>
          <DialogClose asChild>
            <Button
              type='button'
              variant='ghost'
              onClick={handleCloseWithReset}
              className='w-full text-base invisible-ring md:w-auto'>
              Close
            </Button>
          </DialogClose>

          {!error && !annotateError && currentStep < 3 && !isButtonDisabled && (
            <div className='flex w-full justify-between gap-2 px-2 md:w-auto md:justify-end'>
              {currentStep > 0 && (
                <Button
                  variant='ghost'
                  onClick={handlePreviousClick}
                  disabled={isButtonDisabled}
                  className='flex-1 text-base invisible-ring hover:bg-gray-600 md:flex-initial'>
                  Previous Step
                </Button>
              )}
              {((showVidInfo && currentStep === 0) || currentStep > 0) && (
                <Button
                  onClick={handleProceedClick}
                  disabled={isButtonDisabled}
                  className='flex-1 text-white invisible-ring md:flex-initial'>
                  {currentStep === 2 ? 'Proceed' : 'Next Step'}
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      )}
    </DialogContent>
  )
}

export default RequestDialog
