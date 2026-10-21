import {
  ArrowRightIcon,
  Info,
  LogInIcon,
  PlayIcon,
  SearchIcon,
} from 'lucide-react'
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
import { noSongReason, signInWithGoogle, useAccess } from '@/lib/auth'
import { startGeneration } from '@/lib/generation/store'
import { useGetLyricsBySongId } from '@/lib/react-query/queries-and-mutations'
import { YouTubeUrlOrIdValidation } from '@/lib/validation'
import { extractVideoId } from '@/utils'
import { cn } from '@/utils/cn'

import { Spotlight } from '../ui/spotlight'

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

// Search is a mode, not an error, so it gets its own colour; red is kept for a link that fails to parse.
type InputMode = 'empty' | 'search' | 'valid' | 'invalid'

const getInputMode = (
  value: string,
  isSearch: boolean,
  isValidLink: boolean
): InputMode => {
  if (value.trim().length === 0) {
    return 'empty'
  }
  if (isSearch) {
    return 'search'
  }
  return isValidLink ? 'valid' : 'invalid'
}

const HeroGenerateLyricsDefault = ({
  setInputVideoId,
}: HeroGenerateLyricsDefaultProps) => {
  const [inputValue, setInputValue] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [validationSuccess, setValidationSuccess] = useState(false)
  // A tooltip only opens on hover or keyboard focus, so a tap toggles it too
  const [infoOpen, setInfoOpen] = useState(false)
  const navigate = useNavigate()
  const isSearch =
    inputValue.trim().length > 0 && !looksLikeYoutubeLink(inputValue)
  const inputMode = getInputMode(inputValue, isSearch, validationSuccess)

  const extractedVideoId = useMemo(() => {
    if (!inputValue) {
      return ''
    }

    const result = YouTubeUrlOrIdValidation.safeParse(inputValue)
    if (!result.success) {
      return ''
    }

    const id = extractVideoId(inputValue)
    return id ?? ''
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
    if (result.success) {
      const vidId = extractVideoId(value)
      if (vidId !== null && vidId !== '') {
        setValidationSuccess(true)
        setErrorMessage('')
      } else {
        setErrorMessage('Invalid URL')
        setValidationSuccess(false)
      }
    } else {
      setErrorMessage(
        result.error.issues.map((error) => error.message).join(', ')
      )
      setValidationSuccess(false)
    }
  }

  // A new song here would be refused, so offer what would work instead: sign-in for a guest, nothing for a
  // signed-in user who has used today's songs
  const access = useAccess()
  const blocked =
    !isSearch &&
    validationSuccess &&
    !isCheckingLyrics &&
    !existingLyrics &&
    !access.newSong

  const handleOpenLandingPageDialog = () => {
    if (isSearch) {
      void navigate(`/search?q=${encodeURIComponent(inputValue.trim())}`)
      return
    }
    if (validationSuccess && extractedVideoId) {
      setInputVideoId(extractedVideoId)

      if (existingLyrics) {
        void navigate(`/v/${extractedVideoId}`, {
          state: { videoId: extractedVideoId },
        })
      } else if (blocked) {
        void signInWithGoogle()
      } else {
        startGeneration({ mode: 'new', videoId: extractedVideoId })
      }
    }
  }

  const statusMessage = () => {
    if (errorMessage) {
      return errorMessage
    }
    if (isCheckingLyrics) {
      return 'Valid URL - Searching for lyrics...'
    }
    if (existingLyrics) {
      return 'Lyrics & translations found!'
    }
    if (blocked) {
      return access.kind === 'user'
        ? noSongReason(access.quota)
        : "You've used today's free song. Sign in to generate more."
    }
    return validationSuccess ? 'Valid YouTube URL' : ''
  }

  const buttonLabel = () => {
    if (isSearch) {
      return 'Search'
    }
    if (isCheckingLyrics) {
      return 'Searching ...'
    }
    if (blocked) {
      return 'Sign In to Generate'
    }
    return existingLyrics ? 'Play Video' : 'Try Now'
  }

  const buttonIcon = () => {
    if (isSearch) {
      return <SearchIcon className='size-6 shrink-0' />
    }
    if (isCheckingLyrics) {
      return ''
    }
    if (blocked) {
      return <LogInIcon className='size-6 shrink-0' />
    }
    return existingLyrics ? (
      <PlayIcon className='size-6 shrink-0 fill-current' />
    ) : (
      <ArrowRightIcon className='size-6 shrink-0' />
    )
  }

  return (
    <div className='relative flex w-full overflow-hidden rounded-md pt-10 antialiased md:h-100 md:justify-center'>
      <Spotlight
        className='-top-8 left-10 md:-top-20 md:left-60'
        fill='#580a24'
      />

      <div className='z-10 mx-auto flex-between w-full max-w-7xl flex-col gap-4 p-4 lg:gap-0 xl:flex-around xl:h-96'>
        <h1 className='bg-linear-to-b from-hero-from to-hero-to bg-clip-text pb-2 text-center text-4xl font-bold text-transparent no-select md:text-6xl lg:text-7xl'>
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
            placeholder='Search or paste a YouTube URL'
            variant='hero'
            state={inputMode}
          />
          <div className='absolute -bottom-20 left-0 h-20 w-full py-6 pt-2 text-center md:text-left lg:py-2'>
            {inputMode === 'search' && (
              <div className='text-search'>Search by title, artist or mood</div>
            )}
            {inputValue.length > 0 && !isSearch && (
              <div
                className={cn(
                  'text-success',
                  blocked && 'text-muted-foreground',
                  errorMessage !== '' && 'text-error-strong'
                )}>
                {statusMessage()}
              </div>
            )}
          </div>
          {!(blocked && access.kind === 'user') && (
            <Button
              onClick={() => {
                if (inputValue?.length === 0) {
                  return
                }
                handleOpenLandingPageDialog()
              }}
              disabled={errorMessage !== '' || isCheckingLyrics}
              variant='hero'
              size='tall'
              gap='md'
              className='w-full md:w-1/2 lg:w-1/4'>
              <p className='text-body'>{buttonLabel()}</p>
              {buttonIcon()}
            </Button>
          )}
        </div>

        <div className='flex items-center justify-center gap-2'>
          <p className='mx-auto mt-4 text-center text-base font-normal text-tagline no-select lg:mt-0'>
            Transform YouTube videos into your personalized Japanese karaoke
            stage, with AI-transcribed, accurately synced lyrics and
            translations
          </p>
          <TooltipProvider delayDuration={0}>
            <Tooltip open={infoOpen} onOpenChange={setInfoOpen}>
              <TooltipTrigger asChild>
                <button
                  type='button'
                  aria-label='About Accuracy'
                  onClick={() => {
                    setInfoOpen((open) => !open)
                  }}
                  className='-m-2 rounded-full p-2'>
                  <Info className='h-4 w-4 text-tagline' />
                </button>
              </TooltipTrigger>
              <TooltipContent
                className='max-w-[calc(100vw-2rem)]'
                collisionPadding={16}
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
