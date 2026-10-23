import {
  ArrowRightIcon,
  Info,
  LoaderCircleIcon,
  PlayIcon,
  SearchIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'

import { startFromButton } from '@/components/generation/start-generation'
import { GoogleMark } from '@/components/shared/google-mark'
import { Button } from '@/components/ui/button'
import { Input, InputField } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { noSongReason, signInWithGoogle, useAccess } from '@/lib/auth'
import { useGetLyricsBySongId } from '@/lib/react-query/queries-and-mutations'
import { YouTubeUrlOrIdValidation } from '@/lib/validation'
import { extractVideoId } from '@/utils'
import { cn } from '@/utils/cn'

interface HeroGenerateLyricsDefaultProps {
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
  // Asking the backend whether it would take the song, before the panel opens
  const [checking, setChecking] = useState(false)
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
        setChecking(true)
        void (async () => {
          await startFromButton(
            { mode: 'new', videoId: extractedVideoId },
            { announce: false }
          )
          setChecking(false)
        })()
      }
    }
  }

  const statusMessage = () => {
    if (errorMessage) {
      return errorMessage
    }
    if (isCheckingLyrics) {
      return 'Looking for lyrics…'
    }
    if (existingLyrics) {
      return 'Lyrics and translations ready'
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
      return 'Searching…'
    }
    if (checking) {
      return 'Starting…'
    }
    if (blocked) {
      return 'Sign In to Generate'
    }
    return existingLyrics ? 'Play Video' : 'Try Now'
  }

  const buttonIcon = () => {
    if (isSearch) {
      return <SearchIcon className='size-5 shrink-0' />
    }
    if (isCheckingLyrics || checking) {
      return null
    }
    if (blocked) {
      return <GoogleMark />
    }
    return existingLyrics ? (
      <PlayIcon className='size-5 shrink-0 fill-current' />
    ) : (
      <ArrowRightIcon className='size-5 shrink-0' />
    )
  }

  const showAction = !(blocked && access.kind === 'user')
  const actionDisabled = errorMessage !== '' || isCheckingLyrics || checking
  const submit = () => {
    if (inputValue.length === 0 || actionDisabled) {
      return
    }
    handleOpenLandingPageDialog()
  }
  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-5 pt-12 pb-10 md:items-center md:pt-20 md:pb-14 installed:pt-4 installed:pb-6 short:gap-3 short:pt-4 short:pb-6'>
      <h1
        className={cn(
          // The first lines of the home page's rise, a line at a time
          'in-data-rise:rise-in',
          'text-left text-4xl font-semibold tracking-tight text-balance text-foreground no-select md:text-center md:text-6xl installed:hidden short:text-4xl'
        )}>
        AI-Powered Japanese Karaoke
      </h1>
      {/* The info button sits inline at the end of the sentence, so it stays beside the words as they wrap */}
      <p
        className={cn(
          'in-data-rise:rise-in in-data-rise:rise-delay-100',
          'text-base text-pretty text-tagline no-select md:text-center md:text-lg installed:hidden short:text-base'
        )}>
        Paste a YouTube link and sing along with synced lyrics, furigana, romaji
        and translations
        <TooltipProvider delayDuration={0}>
          <Tooltip open={infoOpen} onOpenChange={setInfoOpen}>
            <TooltipTrigger asChild>
              <button
                type='button'
                aria-label='About Accuracy'
                onClick={() => {
                  setInfoOpen((open) => !open)
                }}
                className='relative -top-0.5 -my-2 ml-1 inline-flex rounded-full p-1.5 align-middle'>
                <Info className='h-4 w-4 text-tagline' />
              </button>
            </TooltipTrigger>
            {/* Above the icon and centred on it, clear of the link field under the line */}
            <TooltipContent
              className='max-w-[calc(100vw-2rem)]'
              collisionPadding={16}
              side='top'
              sideOffset={6}>
              Synbox is powered by AI and can make mistakes.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </p>
      <div
        className={cn(
          'in-data-rise:rise-in in-data-rise:rise-delay-200',
          'mt-3 flex w-full flex-col gap-2 md:max-w-170'
        )}>
        {/* The field draws the border and its state; the action sits inside it, a labelled pill from sm up and a
            round icon on phones, where the label would squeeze the text */}
        {/* A form, so Enter or the keyboard's Go key does what the button does, for a link as for a search */}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}>
          <InputField state={inputMode} className='relative'>
            <Input
              value={inputValue}
              onChange={handleInputChange}
              aria-label='Search songs or paste a YouTube link'
              enterKeyHint={isSearch ? 'search' : 'go'}
              autoCapitalize='off'
              autoCorrect='off'
              spellCheck={false}
              placeholder='Search or paste a YouTube URL'
              data-bench='hero-input'
              variant='bare'
            />
            {showAction && (
              <>
                <Button
                  type='submit'
                  disabled={actionDisabled}
                  variant='hero'
                  size='icon'
                  aria-label={buttonLabel()}
                  className='shrink-0 sm:hidden'>
                  {buttonIcon() ?? (
                    <LoaderCircleIcon className='size-5 shrink-0 motion-safe:animate-spin' />
                  )}
                </Button>
                <Button
                  type='submit'
                  disabled={actionDisabled}
                  variant='hero'
                  size='inset'
                  gap='sm'
                  className='hidden shrink-0 sm:inline-flex'>
                  {/* Google's mark leads its label, as its sign-in branding asks; the other icons trail */}
                  {blocked ? buttonIcon() : null}
                  <span className='text-label'>{buttonLabel()}</span>
                  {blocked ? null : buttonIcon()}
                </Button>
              </>
            )}
          </InputField>
        </form>
        <div className='min-h-6 px-5 text-sm' aria-live='polite'>
          {inputMode === 'search' && (
            <p className='text-search'>Search by title, artist or mood</p>
          )}
          {inputValue.length > 0 && !isSearch && (
            <p
              className={cn(
                'text-success',
                blocked && 'text-muted-foreground',
                errorMessage !== '' && 'text-error-strong'
              )}>
              {statusMessage()}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default HeroGenerateLyricsDefault
