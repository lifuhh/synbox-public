import { useState } from 'react'

import { ScrollArea } from '@/components/ui/scroll-area'

import { TooltipProvider } from '../ui/tooltip'

interface Lyric {
  start_time: number
  end_time: number
  lyric: string
}

interface RequestDialogLyricsDisplayProps {
  timestampedLyrics: Lyric[]
  isAiGenerated: boolean
}

const RequestDialogLyricsDisplay = ({
  timestampedLyrics,
  isAiGenerated,
}: RequestDialogLyricsDisplayProps) => {
  const [localLyrics] = useState<Lyric[]>(timestampedLyrics)

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.floor(seconds % 60)
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`
  }

  return (
    <div className='w-full'>
      <TooltipProvider>
        <ScrollArea
          className={`w-full lyrics-scroll-area rounded-md border bg-background p-4 ${isAiGenerated ? 'h-[40vh]' : 'h-[50vh]'}`}>
          {localLyrics.map((lyric, index) => (
            <div
              key={index}
              className='mb-2 flex w-full items-center justify-between rounded-lg bg-primary/40 p-2'>
              <span className='mr-2 text-sm font-medium text-secondary-foreground'>
                [{formatTime(lyric.start_time)} - {formatTime(lyric.end_time)}]
              </span>
              <span className='grow'>{lyric.lyric}</span>
            </div>
          ))}
        </ScrollArea>
        {isAiGenerated ? (
          <p className='mt-2 text-sm text-yellow-600'>
            Lyrics are AI-transcribed, there may be errors.
          </p>
        ) : (
          <p className='mt-2 text-sm text-green-500'>
            Lyrics are uploaded by the channel owner.
          </p>
        )}
      </TooltipProvider>
    </div>
  )
}

export default RequestDialogLyricsDisplay
