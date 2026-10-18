import { useEffect, useState } from 'react'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useStreamAnnotateApi } from '@/hooks/useStreamAnnotateApi'

import type { Step } from './ProgressUpdate'
import { ProgressUpdate } from './ProgressUpdate'
import UpdateMessagesDisplay from './UpdateMessagesDisplay'

const RequestDialogAnnotateDisplay = ({
  id,
  lyrics,
  timestampedLyrics,
  onAnnotationsUpdate,
  onError,
  onStreamingStatusChange,
}) => {
  const {
    isStreaming,
    updateMessages,
    engTranslation,
    chiTranslation,
    romajiLyrics,
    kanjiAnnotations,
    isDataComplete,
    error,
    mutate,
    currentTask,
    isPersisted,
  } = useStreamAnnotateApi()

  const [isBuffering, setIsBuffering] = useState(true)
  const [showProgressUpdate, setShowProgressUpdate] = useState(true)

  useEffect(() => {
    mutate({ vidId: id, lyrics, timestampedLyrics })
  }, [id, lyrics, timestampedLyrics, mutate])

  useEffect(() => {
    if (!isStreaming && isBuffering) {
      setShowProgressUpdate(false)
    } else {
      setShowProgressUpdate(true)
    }
  }, [isStreaming, isBuffering])

  useEffect(() => {
    onStreamingStatusChange(isStreaming || isBuffering)
  }, [isStreaming, isBuffering, onStreamingStatusChange])

  useEffect(() => {
    if (isDataComplete) {
      const timer = setTimeout(() => {
        setIsBuffering(false)
        onAnnotationsUpdate(
          engTranslation,
          chiTranslation,
          romajiLyrics,
          kanjiAnnotations,
          isPersisted
        )
      }, 2000)
      return () => {
        clearTimeout(timer)
      }
    }
  }, [
    isDataComplete,
    engTranslation,
    chiTranslation,
    romajiLyrics,
    kanjiAnnotations,
    isPersisted,
    onAnnotationsUpdate,
  ])

  useEffect(() => {
    if (error) {
      onError(error)
    }
  }, [error, onError])

  const renderScrollableContent = (content) => {
    if (!content) {
      return null
    }
    return (
      <div className='h-80 overflow-y-auto rounded-sm border border-gray-300 p-2'>
        {content.map((line, index) => (
          <p key={index} className='whitespace-pre-wrap'>
            {line}
          </p>
        ))}
      </div>
    )
  }

  const renderTabs = () => (
    <>
      <p className='mb-4 text-center text-lg leading-[1.6] font-bold'>
        Preview
      </p>
      <Tabs defaultValue='lyrics' className='w-full'>
        <TabsList className='grid w-full grid-cols-4'>
          <TabsTrigger value='lyrics'>Lyrics</TabsTrigger>
          <TabsTrigger value='english'>English</TabsTrigger>
          <TabsTrigger value='chinese'>Chinese</TabsTrigger>
          <TabsTrigger value='romaji'>Romaji</TabsTrigger>
        </TabsList>
        <TabsContent value='lyrics'>
          {renderScrollableContent(lyrics)}
        </TabsContent>
        <TabsContent value='english'>
          {renderScrollableContent(engTranslation)}
        </TabsContent>
        <TabsContent value='chinese'>
          {renderScrollableContent(chiTranslation)}
        </TabsContent>
        <TabsContent value='romaji'>
          {renderScrollableContent(romajiLyrics)}
        </TabsContent>
      </Tabs>
    </>
  )

  const initialSteps: Step[] = [
    { id: 'translation', title: 'Translation', status: 'pending' },
    { id: 'romaji', title: 'Romaji Annotation', status: 'pending' },
    { id: 'kanji', title: 'Kanji Annotation', status: 'pending' },
    { id: 'completion', title: 'Finalizing', status: 'pending' },
  ]

  const steps: Step[] = initialSteps
    .map((step): Step => {
      if (currentTask === step.id) {
        return { ...step, status: 'active' }
      }
      if (
        (step.id === 'translation' && (engTranslation || chiTranslation)) ||
        (step.id === 'romaji' && romajiLyrics) ||
        (step.id === 'kanji' && kanjiAnnotations) ||
        currentTask === 'completion'
      ) {
        return { ...step, status: 'completed' }
      }
      return step
    })
    .filter((step) => step.id !== 'completion')

  return (
    <div className='w-full'>
      {!error && (isStreaming || isBuffering) ? (
        <div className='mt-4 w-full'>
          {showProgressUpdate && <ProgressUpdate steps={steps} />}
          <UpdateMessagesDisplay
            isStreaming={isStreaming}
            showLoader={isBuffering}
            updateMessages={updateMessages}
          />
        </div>
      ) : !error ? (
        renderTabs()
      ) : null}
    </div>
  )
}

export default RequestDialogAnnotateDisplay
