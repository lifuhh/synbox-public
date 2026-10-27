import { useSetAtom } from 'jotai'
import {
  Info,
  LoaderCircleIcon,
  PlayIcon,
  SearchIcon,
  ArrowRightIcon,
} from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import {
  GenerateLabel,
  SubmissionStatus,
  useFieldGeneration,
} from '@/components/generate-lyrics/field-generation'
import { Button } from '@/components/ui/button'
import { ClearFieldButton } from '@/components/ui/clear-field-button'
import { Input, InputField } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { homeSearchFieldAtom } from '@/context/atoms'
import { useMediaQuery } from '@/hooks/use-media-query'
import { openRequestMore } from '@/lib/account-prompts'
import type { Access } from '@/lib/auth'
import {
  signInWithGoogle,
  songsDoneText,
  useAccess,
  useGuestSongUsed,
} from '@/lib/auth'
import { useGetLyricsBySongId } from '@/lib/react-query/queries-and-mutations'
import { BAD_LINK, readFieldText } from '@/utils'
import { cn } from '@/utils/cn'

interface HeroGenerateLyricsDefaultProps {
  setInputVideoId: (videoId: string) => void
  inputVideoId: string
}

// The top bar's words (topbar-search.tsx), so the field flying into the bar carries the same text it lands with.
// Under 360px wide the full text runs past the field
const heroPlaceholder = (roomy: boolean) =>
  roomy ? 'Search or Paste a YouTube Link' : 'Search or Paste a Link'

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

interface SongNote {
  text: string
  action: { label: string; handleClick: () => void }
}

const signIn = () => {
  void signInWithGoogle()
}

// The line under a link that would make a new song, when there's something to say: a guest's one free song, and
// signing in for more; an account out of today's songs, when more come and Request More
const newSongNote = (access: Access, guestSpent: boolean): SongNote | null => {
  if (access.kind === 'guest') {
    return access.ready
      ? {
          action: { handleClick: signIn, label: 'Sign In for 5 a Day' },
          text:
            access.newSong && !guestSpent
              ? 'Your free song'
              : 'That’s your free song',
        }
      : null
  }
  return access.newSong
    ? null
    : {
        action: { handleClick: openRequestMore, label: 'Request More' },
        text: songsDoneText(access.quota),
      }
}

// The note for a link that would make a new song; a guest's device is asked about its free song only then
const useNewSongNote = (access: Access, newSong: boolean) => {
  const guestSpent = useGuestSongUsed(
    newSong && access.kind === 'guest' && access.ready
  )
  return newSong ? newSongNote(access, guestSpent) : null
}

const HeroGenerateLyricsDefault = ({
  setInputVideoId,
}: HeroGenerateLyricsDefaultProps) => {
  const [inputValue, setInputValue] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const statusId = useId()
  const roomy = useMediaQuery('(min-width: 22.5rem)')
  // Generate Lyrics' check, its answer, and the field emptying once the song started
  const { busy, checking, clearing, edited, generate, refused, submission } =
    useFieldGeneration(() => {
      setInputValue('')
    })
  // A tooltip only opens on hover or keyboard focus, so a tap toggles it too
  const [infoOpen, setInfoOpen] = useState(false)
  const navigate = useNavigate()
  // The top bar's search docks from this field once it scrolls under the bar
  const setDockField = useSetAtom(homeSearchFieldAtom)
  // Words search; a Synbox link opens its own page (no lyrics lookup, no generation); a YouTube link plays or
  // generates (utils › readFieldText, as the Search page and the top bar read it)
  const text = readFieldText(inputValue)
  const ownPath = text.kind === 'own' ? text.path : null
  const isSearch = text.kind === 'search'
  const validationSuccess = text.kind === 'video'
  const extractedVideoId = text.kind === 'video' ? text.videoId : ''
  const errorMessage = text.kind === 'bad' ? BAD_LINK : ''
  const inputMode = getInputMode(
    inputValue,
    isSearch,
    validationSuccess || ownPath !== null
  )

  const { data: existingLyrics, isLoading: isCheckingLyrics } =
    useGetLyricsBySongId(extractedVideoId)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
    edited()
  }

  // A link that would make a new song: an account that added today's songs is told when more come instead of
  // offered a song that would be turned away; a guest hears it's their free song, and keeps Generate Lyrics even
  // once it's spent (the press brings the sign-in sheet, start-generation.tsx)
  const access = useAccess()
  const newSong =
    !isSearch && validationSuccess && !isCheckingLyrics && !existingLyrics
  const note = useNewSongNote(access, newSong)
  const blocked = newSong && access.kind === 'user' && !access.newSong

  const handleOpenLandingPageDialog = () => {
    if (ownPath !== null) {
      void navigate(ownPath)
      return
    }
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
      } else if (!blocked) {
        void generate(extractedVideoId)
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
      return 'Lyrics Ready'
    }
    if (note !== null) {
      return note.text
    }
    return validationSuccess ? 'Valid YouTube URL' : ''
  }

  const buttonLabel = () => {
    if (ownPath !== null) {
      return ownPath.startsWith('/lyrics/') ? 'Open Lyrics' : 'Watch Now'
    }
    if (isSearch) {
      return 'Search'
    }
    if (isCheckingLyrics) {
      return 'Searching…'
    }
    if (checking) {
      return 'Checking…'
    }
    return existingLyrics ? 'Play Video' : 'Generate Lyrics'
  }

  const buttonIcon = () => {
    if (ownPath !== null) {
      return <PlayIcon className='size-5 shrink-0 fill-current' />
    }
    if (isSearch) {
      return <SearchIcon className='size-5 shrink-0' />
    }
    if (isCheckingLyrics || checking) {
      return null
    }
    return existingLyrics ? (
      <PlayIcon className='size-5 shrink-0 fill-current' />
    ) : (
      <ArrowRightIcon className='size-5 shrink-0' />
    )
  }

  const showAction = !blocked
  // While its check runs the button stays focusable (aria-disabled) and a press does nothing
  const actionDisabled = errorMessage !== '' || isCheckingLyrics
  const submit = () => {
    if (inputValue.length === 0 || actionDisabled || busy()) {
      return
    }
    handleOpenLandingPageDialog()
  }
  const busyAttr = checking || undefined
  // The pill's content: Generate Lyrics while that is the action or its check runs, sharing one width
  const pillContent = () => {
    const generating =
      checking ||
      (validationSuccess &&
        !isSearch &&
        ownPath === null &&
        !isCheckingLyrics &&
        !existingLyrics &&
        !blocked)
    if (generating) {
      return <GenerateLabel checking={checking} />
    }
    return (
      <>
        {/* Google's mark leads its label, as its sign-in branding asks; the other icons trail */}
        {blocked ? buttonIcon() : null}
        <span className='text-label'>{buttonLabel()}</span>
        {blocked ? null : buttonIcon()}
      </>
    )
  }
  // What the line under the field says while no press is being answered
  const fieldStatus = () => {
    if (inputMode === 'search') {
      return <p className='text-search'>Search by title, artist or mood</p>
    }
    if (inputValue.length === 0 || isSearch) {
      return null
    }
    return (
      <p
        className={cn(
          'text-success',
          note !== null && 'text-muted-foreground',
          errorMessage !== '' && 'text-error-strong'
        )}>
        {statusMessage()}
        {note !== null && errorMessage === '' && (
          // The dot and the button wrap together, never a dot left at a line's end
          <span className='whitespace-nowrap'>
            {' · '}
            <button
              type='button'
              onClick={note.action.handleClick}
              className="relative font-semibold text-foreground underline underline-offset-4 after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']">
              {note.action.label}
            </button>
          </span>
        )}
      </p>
    )
  }
  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-5 pt-12 pb-10 md:items-center md:pt-20 md:pb-14 installed:pt-4 installed:pb-6 short:gap-3 short:pt-4 short:pb-6'>
      <h1
        className={cn(
          // The first lines of the home page's rise, a line at a time
          'in-data-rise:rise-in',
          'text-left text-4xl font-semibold tracking-tight text-balance text-foreground no-select md:text-center md:text-6xl installed:sr-only short:text-4xl'
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
                className='-my-2 ml-1 inline-flex rounded-full p-1.5 align-middle'>
                <Info className='h-4 w-4 text-tagline' />
              </button>
            </TooltipTrigger>
            {/* Above the icon and centred on it, clear of the link field under the line */}
            <TooltipContent
              className='max-w-[calc(100vw-2rem)]'
              collisionPadding={16}
              side='top'
              sideOffset={6}>
              Lyrics are made by AI and can have mistakes
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
          aria-busy={busyAttr}
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}>
          <InputField
            ref={setDockField}
            state={refused ? 'invalid' : inputMode}
            className='relative'>
            <Input
              ref={field}
              value={inputValue}
              onChange={handleInputChange}
              readOnly={checking}
              data-clearing={clearing || undefined}
              aria-label='Search Songs or Paste a YouTube Link'
              enterKeyHint={isSearch ? 'search' : 'go'}
              autoCapitalize='off'
              autoCorrect='off'
              spellCheck={false}
              placeholder={heroPlaceholder(roomy)}
              aria-invalid={errorMessage !== '' || refused}
              aria-describedby={statusId}
              data-bench='hero-input'
              variant='bare'
            />
            {/* Not while Generate Lyrics checks the song: the field is read-only then */}
            <ClearFieldButton
              field={field}
              value={inputValue}
              off={checking}
              onClear={() => {
                setInputValue('')
                edited()
              }}
            />
            {showAction && (
              <>
                <Button
                  type='submit'
                  disabled={actionDisabled}
                  aria-disabled={busyAttr}
                  variant='hero'
                  size='icon'
                  aria-label={buttonLabel()}
                  className='shrink-0 aria-disabled:cursor-progress sm:hidden'>
                  {buttonIcon() ?? (
                    <LoaderCircleIcon className='size-5 shrink-0 motion-safe:animate-spin' />
                  )}
                </Button>
                <Button
                  type='submit'
                  disabled={actionDisabled}
                  aria-disabled={busyAttr}
                  variant='hero'
                  size='inset'
                  gap='sm'
                  className='hidden shrink-0 aria-disabled:cursor-progress sm:inline-flex'>
                  {pillContent()}
                </Button>
              </>
            )}
          </InputField>
        </form>
        <div id={statusId} className='min-h-6 px-5 text-sm' aria-live='polite'>
          {submission.kind === 'idle' ? (
            fieldStatus()
          ) : (
            <SubmissionStatus submission={submission} />
          )}
        </div>
      </div>
    </div>
  )
}

export default HeroGenerateLyricsDefault
