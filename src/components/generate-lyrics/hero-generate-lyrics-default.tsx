import { useSetAtom } from 'jotai'
import {
  CheckIcon,
  LoaderCircleIcon,
  PlayIcon,
  SearchIcon,
  ArrowRightIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import {
  GenerateLabel,
  INLINE_ACTION,
  SubmissionStatus,
  useFieldGeneration,
  useWarmGeneration,
} from '@/components/generate-lyrics/field-generation'
import {
  SONG_FIELD_HINT,
  SongFieldAction,
  songFieldPlaceholder,
  songFieldState,
} from '@/components/search/song-field'
import type { SongFieldState } from '@/components/search/song-field'
import { ClearFieldButton } from '@/components/ui/clear-field-button'
import { Input, InputField } from '@/components/ui/input'
import { homeSearchFieldAtom } from '@/context/atoms'
import { useMediaQuery } from '@/hooks/use-media-query'
import { openRequestMore } from '@/lib/account-prompts'
import type { Access } from '@/lib/auth'
import {
  SONGS_A_DAY,
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
          action: {
            handleClick: signIn,
            label: `Sign In for ${SONGS_A_DAY} a Day`,
          },
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

// The line under a link. Only a bad link takes a colour: a good one is said by this line and the button's label,
// never by a second hue beside the magenta action
const LinkLine = ({
  message,
  error,
  ready,
  note,
}: {
  message: string
  error: boolean
  ready: boolean
  note: SongNote | null
}) =>
  ready ? (
    <p className='flex items-center gap-1.5 text-muted-foreground'>
      <CheckIcon aria-hidden className='size-3.5 shrink-0' />
      {message}
    </p>
  ) : (
    <p className={error ? 'text-error-strong' : 'text-muted-foreground'}>
      {message}
      {note !== null && !error && (
        // The dot and the button wrap together, never a dot left at a line's end
        <span className='whitespace-nowrap'>
          {' · '}
          <button
            type='button'
            onClick={note.action.handleClick}
            className={INLINE_ACTION}>
            {note.action.label}
          </button>
        </span>
      )}
    </p>
  )

const LYRICS_READY = 'Lyrics Ready'

const PLAY = <PlayIcon className='size-5 shrink-0 fill-current' />

// What the button does with what was typed: Search for words (and on an empty field, as the placeholder leads with
// it), Play Song for a song with lyrics, Generate Lyrics for a new one. While a pasted link is looked up the icon's
// place holds a spinner (still under Reduce Motion)
const fieldAction = ({
  ownPath,
  mode,
  looking,
  checking,
  ready,
}: {
  ownPath: string | null
  mode: SongFieldState
  looking: boolean
  checking: boolean
  ready: boolean
}): { label: string; icon: ReactNode } => {
  if (ownPath !== null) {
    return {
      icon: PLAY,
      label: ownPath.startsWith('/lyrics/') ? 'Open Lyrics' : 'Watch Now',
    }
  }
  if (mode === 'empty' || mode === 'search') {
    return { icon: <SearchIcon className='size-5 shrink-0' />, label: 'Search' }
  }
  if (looking || checking) {
    return {
      icon: (
        <LoaderCircleIcon className='size-5 shrink-0 motion-safe:animate-spin' />
      ),
      label: looking ? 'Searching…' : 'Checking…',
    }
  }
  return ready
    ? { icon: PLAY, label: 'Play Song' }
    : {
        icon: <ArrowRightIcon className='size-5 shrink-0' />,
        label: 'Generate Lyrics',
      }
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
  const inputMode = songFieldState(inputValue)

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
  useWarmGeneration(newSong && !blocked ? extractedVideoId : null)

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
      return LYRICS_READY
    }
    if (note !== null) {
      return note.text
    }
    return validationSuccess ? 'Valid YouTube URL' : ''
  }

  const action = fieldAction({
    checking,
    looking: isCheckingLyrics,
    mode: inputMode,
    ownPath,
    ready: Boolean(existingLyrics),
  })

  // While its check runs the button stays focusable (aria-disabled) and a press does nothing
  const actionDisabled = errorMessage !== '' || isCheckingLyrics
  const submit = () => {
    if (inputValue.length === 0 || actionDisabled || busy()) {
      return
    }
    handleOpenLandingPageDialog()
  }
  // Generate Lyrics' own label while that is the action or its check runs, each at its own width
  const generating = () =>
    checking ||
    (validationSuccess &&
      ownPath === null &&
      !isCheckingLyrics &&
      !existingLyrics &&
      !blocked)
  // What the line under the field says while no press is being answered
  const fieldStatus = () => {
    if (inputMode === 'search') {
      return <p className='text-search'>{SONG_FIELD_HINT}</p>
    }
    if (inputMode === 'empty') {
      return null
    }
    return (
      <LinkLine
        message={statusMessage()}
        error={errorMessage !== ''}
        ready={statusMessage() === LYRICS_READY}
        note={note}
      />
    )
  }
  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-5 pt-4 pb-6 md:items-center short:gap-3'>
      {/* The page's name for search engines and screen readers. The field leads the page in every view; what Synbox
          is, for a reader that runs no script, is in index.html › #static-home */}
      <h1 className='sr-only'>AI-Powered Japanese Karaoke</h1>
      <div
        className={cn(
          // The first line of the home page's rise
          'in-data-rise:rise-in',
          'mt-3 flex w-full flex-col gap-2 md:max-w-170 touch:gap-4'
        )}>
        {/* The field draws the border and its state; the action sits inside it (song-field.tsx) */}
        {/* A form, so Enter or the keyboard's Go key does what the button does, for a link as for a search */}
        <form
          aria-busy={checking || undefined}
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
              data-search-key
              value={inputValue}
              onChange={handleInputChange}
              readOnly={checking}
              data-clearing={clearing || undefined}
              aria-label='Search Songs or Paste a YouTube Link'
              enterKeyHint={isSearch ? 'search' : 'go'}
              autoCapitalize='off'
              autoCorrect='off'
              spellCheck={false}
              placeholder={songFieldPlaceholder(roomy)}
              aria-invalid={errorMessage !== '' || refused}
              aria-describedby={statusId}
              data-bench='hero-input'
              variant='bare'
            />
            {/* Not while Generate Lyrics checks the song: the field is read-only then */}
            {/* 3px closer to the action than the field's gap: its × glyph sits 6px inside its own box, so the drawn
                gap to the action was 14px, now 11 */}
            <ClearFieldButton
              field={field}
              value={inputValue}
              off={checking}
              className='-mr-[3px]'
              onClear={() => {
                setInputValue('')
                edited()
              }}
            />
            {!blocked && (
              <SongFieldAction
                label={action.label}
                icon={action.icon}
                pill={
                  generating() ? (
                    <GenerateLabel checking={checking} />
                  ) : undefined
                }
                disabled={actionDisabled}
                busy={checking}
              />
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
