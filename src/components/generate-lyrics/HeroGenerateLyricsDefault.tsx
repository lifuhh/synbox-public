import { ArrowRightIcon, Info, PlayIcon, SearchIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import useRequestDialog from '@/hooks/useRequestDialog'
import { useGetLyricsBySongId } from '@/lib/react-query/queriesAndMutations'
import { YouTubeUrlOrIdValidation } from '@/lib/validation'
import { extractVideoId } from '@/utils'

import RequestDialog from '../shared/RequestDialog'
import { Dialog, DialogTrigger } from '../ui/dialog'
import { Spotlight } from '../ui/Spotlight'

interface HeroGenerateLyricsDefaultProps {
  setProcessingStage: (stage: number) => void
  setInputVideoId: (videoId: string) => void
  inputVideoId: string
}

// A bare 11-character word only counts as a video id when it has a digit, - or _, or mixed case.
const looksLikeYoutubeLink = (value: string) => {
  const text = value.trim()
  if (/youtube\.com|youtu\.be|https?:\/\//u.test(text)) {
    return true
  }
  return (
    /^[\w-]{11}$/u.test(text) &&
    (/[\d_-]/u.test(text) || (/[a-z]/u.test(text) && /[A-Z]/u.test(text)))
  )
}

const HeroGenerateLyricsDefault = ({
  setInputVideoId,
}: HeroGenerateLyricsDefaultProps) => {
  const [inputValue, setInputValue] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [validationSuccess, setValidationSuccess] = useState(false)
  const dialog = useRequestDialog()
  const navigate = useNavigate()
  const isSearch =
    inputValue.trim().length > 0 && !looksLikeYoutubeLink(inputValue)

  const extractedVideoId = useMemo(() => {
    if (!inputValue) {
      return ''
    }

    const result = YouTubeUrlOrIdValidation.safeParse(inputValue)
    if (!result.success) {
      return ''
    }

    const id = extractVideoId(inputValue)
    return id || ''
  }, [inputValue])

  const { data: existingLyrics, isLoading: isCheckingLyrics } =
    useGetLyricsBySongId(validationSuccess ? extractedVideoId : '')

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target
    setInputValue(value)

    if (!value || !looksLikeYoutubeLink(value)) {
      setErrorMessage('')
      setValidationSuccess(false)
      return
    }

    const result = YouTubeUrlOrIdValidation.safeParse(value)
    if (!result.success) {
      setErrorMessage(
        result.error.issues.map((error) => error.message).join(', ')
      )
      setValidationSuccess(false)
    } else {
      const vidId = extractVideoId(value)
      if (vidId) {
        setValidationSuccess(true)
        setErrorMessage('')
      } else {
        setErrorMessage('Invalid URL')
        setValidationSuccess(false)
      }
    }
  }

  const handleOpenLandingPageDialog = () => {
    if (isSearch) {
      navigate(`/search?q=${encodeURIComponent(inputValue.trim())}`)
      return
    }
    if (validationSuccess && extractedVideoId) {
      setInputVideoId(extractedVideoId)

      if (existingLyrics) {
        navigate(`/v/${extractedVideoId}`, {
          state: { videoId: extractedVideoId },
        })
      } else {
        dialog.openFor(extractedVideoId)
      }
    }
  }

  return (
    <div className='relative flex w-full overflow-hidden rounded-md pt-10 antialiased md:h-100 md:justify-center'>
      <Spotlight
        className='-top-8 left-10 md:-top-20 md:left-60'
        fill='#580a24'
      />

      <div className='z-10 mx-auto flex-between w-full max-w-7xl flex-col gap-4 p-4 lg:gap-0 xl:flex-around xl:h-96'>
        <h1 className='bg-linear-to-b from-neutral-50 to-neutral-400 bg-clip-text pb-2 text-center text-4xl font-bold text-transparent no-select md:text-6xl lg:text-7xl'>
          AI-Powered Japanese Karaoke
        </h1>
        <div className='relative flex-between flex w-full flex-col gap-4 overflow-visible sm:mx-auto sm:w-4/5 md:flex-row'>
          <Input
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isSearch) {
                handleOpenLandingPageDialog()
              }
            }}
            placeholder='Paste a YouTube URL or search for a song'
            className={`border-2 bg-input/40 py-6 text-white invisible-ring ${
              inputValue.length > 0
                ? validationSuccess
                  ? 'border-green-500 hover:border-foreground focus:border-green-500'
                  : 'border-red-800 hover:border-foreground focus:border-red-800'
                : 'border-foreground/60 hover:border-foreground/80 focus:border-foreground/90'
            } `}
          />
          <div className='absolute -bottom-20 left-0 h-20 w-full py-6 pt-2 text-center md:text-left lg:py-2'>
            {inputValue.length > 0 && !isSearch && (
              <div className={errorMessage ? 'text-red-500' : 'text-green-500'}>
                {errorMessage
                  ? errorMessage
                  : isCheckingLyrics
                    ? 'Valid URL - Searching for lyrics...'
                    : existingLyrics
                      ? 'Lyrics & translations found!'
                      : validationSuccess
                        ? 'Valid YouTube URL'
                        : ''}
              </div>
            )}
          </div>
          <Dialog open={dialog.open} onOpenChange={dialog.handleOpenChange}>
            <DialogTrigger asChild>
              <Button
                onClick={(e) => {
                  if (inputValue?.length === 0 || isSearch) {
                    e.preventDefault()
                  }
                  if (inputValue?.length === 0) {
                    return
                  }
                  handleOpenLandingPageDialog()
                }}
                disabled={
                  errorMessage && errorMessage != ''
                    ? true
                    : false || isCheckingLyrics
                }
                variant='default'
                className='w-full gap-2 border-2 border-primary/90 bg-primary/90 py-6 text-foreground hover:border-primary hover:bg-primary md:w-1/2 lg:w-1/4'>
                {isSearch ? (
                  <p className='text-[16px]'>Search</p>
                ) : isCheckingLyrics ? (
                  <p className='text-[16px]'>Searching ...</p>
                ) : existingLyrics ? (
                  <p className='text-[16px]'>Play Video</p>
                ) : (
                  <p className='text-[16px]'>Try Now</p>
                )}
                {isSearch ? (
                  <SearchIcon className='size-6 shrink-0' />
                ) : isCheckingLyrics ? (
                  ''
                ) : existingLyrics ? (
                  <PlayIcon className='size-6 shrink-0 fill-current' />
                ) : (
                  <ArrowRightIcon className='size-6 shrink-0' />
                )}
              </Button>
            </DialogTrigger>
            <RequestDialog
              key={dialog.dialogKey}
              videoId={dialog.videoId}
              handleClose={dialog.close}
            />
          </Dialog>
        </div>

        <div className='flex items-center justify-center gap-2'>
          <p className='mx-auto mt-4 text-center text-base font-normal text-neutral-300 no-select lg:mt-0'>
            Transform YouTube videos into your personalized Japanese karaoke
            stage, with AI-transcribed, accurately synced lyrics and
            translations
          </p>
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className='rounded-full'>
                  <Info className='h-4 w-4 text-neutral-300' />
                </button>
              </TooltipTrigger>
              <TooltipContent
                className=''
                side='bottom'
                sideOffset={10}
                align='end'>
                <p className='text-center text-pretty'>
                  While AI strives for accuracy, occasional discrepancies in
                  transcription or syncing may occur.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  )
}

export default HeroGenerateLyricsDefault
