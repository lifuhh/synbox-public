import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon, ChevronDownIcon, PlayIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { startFromButton } from '@/components/generation/start-generation'
import Forbidden from '@/components/shared/forbidden'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { useAccess } from '@/lib/auth'
import {
  useActivateLyricsVersion,
  useGetLyricsVersions,
  useGetSongInfoBySongId,
} from '@/lib/react-query/queries-and-mutations'
import { QUERY_KEYS } from '@/lib/react-query/query-keys'
import type { LyricsVersionSummary } from '@/lib/synbox-flask/lyrics-versions'
import { cn } from '@/utils/cn'

// The backend's version sources (synbox-transcribe-whisper › services/lyrics_versions.py, lyrics/persist.py)
const SOURCE_LABELS: Record<string, string> = {
  'before versions': 'Original',
  'edited row': 'Edited by Hand',
  'lyrics-v2': 'Regenerated',
}
// Where a generation's lyrics text came from (services/lyrics/text_sources.py)
const TEXT_SOURCES: Record<string, string> = {
  asr: 'the audio',
  comment: 'a YouTube comment',
  description: 'the video description',
  lrclib: 'LRCLIB',
  uploader_ja: "the uploader's subtitles",
  ytmusic: 'YouTube Music',
}

// The backend's free-text note, e.g. "text from lrclib; 33 of 40 lines verified". The note on a saved
// original repeats what its label says, so it is dropped, and an unknown shape shows as written.
const describeNote = (note: string) => {
  if (note === 'the lyrics shown before this change') {
    return ''
  }
  const parts =
    /^text from (?<source>\w+); (?<verified>\d+) of (?<total>\d+) lines verified$/u.exec(
      note
    )?.groups
  if (!parts) {
    return note
  }
  const { source = '', verified, total } = parts
  return `Lyrics from ${TEXT_SOURCES[source] ?? source} · ${verified} of ${total} lines verified`
}

const COVERAGE: [keyof LyricsVersionSummary['summary'], string][] = [
  ['timed', 'Timing'],
  ['english', 'English'],
  ['chinese', 'Chinese'],
  ['romaji', 'Romaji'],
  ['readings', 'Furigana'],
]
// Below this, a gap is worth a second look
const WEAK = 0.9

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

// Only what falls short is listed: versions differ in their gaps, and a row of 100 %s hides them
const Gaps = ({ summary }: { summary: LyricsVersionSummary['summary'] }) => {
  const gaps = COVERAGE.filter(([key]) => (summary[key] ?? 0) < 1)
  return (
    <p className='flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground'>
      <span className='whitespace-nowrap'>
        <span className='font-medium text-foreground tabular-nums'>
          {summary.lines}
        </span>{' '}
        Lines
      </span>
      {gaps.length === 0 ? (
        <span>Fully Timed and Translated</span>
      ) : (
        gaps.map(([key, label]) => {
          const value = summary[key]
          return (
            <span
              key={key}
              className={cn(
                'whitespace-nowrap',
                (value === null || value < WEAK) && 'text-warning'
              )}>
              {value === null || value === 0 ? (
                `No ${label}`
              ) : (
                <>
                  {label}{' '}
                  <span className='font-medium tabular-nums'>
                    {Math.floor(value * 100)}%
                  </span>
                </>
              )}
            </span>
          )
        })
      )}
    </p>
  )
}

interface VersionCardProps {
  videoId: string
  version: LyricsVersionSummary
  isDefault: boolean
  onMakeDefault: () => void
}

const VersionCard = ({
  videoId,
  version,
  isDefault,
  onMakeDefault,
}: VersionCardProps) => {
  const note = describeNote(version.note)
  return (
    <li className='flex flex-col gap-3 rounded-xl bg-card p-4 sm:flex-row sm:items-center sm:gap-6'>
      <div className='min-w-0 flex-1 space-y-1.5'>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
          <h2 className='font-semibold text-foreground'>
            Version {version.version}
          </h2>
          <span className='text-muted-foreground'>·</span>
          <span className='text-foreground/90'>
            {SOURCE_LABELS[version.source] ?? version.source}
          </span>
          {isDefault && (
            <span className='rounded-full bg-primary-subtle px-2 py-0.5 text-xs font-medium text-primary-text'>
              Default
            </span>
          )}
        </div>
        <p className='text-sm text-muted-foreground'>
          <time dateTime={version.created_at}>
            {dateFormat.format(new Date(version.created_at))}
          </time>
          {note === '' ? '' : ` · ${note}`}
        </p>
        <Gaps summary={version.summary} />
      </div>
      <div className='flex shrink-0 gap-2'>
        <Button asChild size='sm' variant='ghost' gap='sm'>
          <Link
            to={
              isDefault
                ? `/v/${videoId}`
                : `/v/${videoId}?version=${version.version}`
            }>
            <PlayIcon className='size-3.5 fill-current' />
            {isDefault ? 'Play' : 'Preview'}
          </Link>
        </Button>
        {!isDefault && (
          <Button size='sm' variant='outline' onClick={onMakeDefault}>
            Make Default
          </Button>
        )}
      </div>
    </li>
  )
}

interface MakeDefaultDialogProps {
  videoId: string
  version: number | null
  onClose: () => void
}

// Changing what everyone hears is an admin action: only admins see the button, and the backend checks the role
const MakeDefaultDialog = ({
  videoId,
  version,
  onClose,
}: MakeDefaultDialogProps) => {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const { isPending, mutate: activate } = useActivateLyricsVersion()

  const submit = () => {
    if (version === null) {
      return
    }
    setError(null)
    activate(
      { version, videoId },
      {
        onError: (activateError) => {
          setError(activateError.message)
        },
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: [QUERY_KEYS.GET_LYRICS_VERSIONS, videoId],
          })
          // The player's lyrics query never refetches on mount, so drop it to load the new default.
          queryClient.removeQueries({
            queryKey: [QUERY_KEYS.GET_LYRICS_BY_SONG_ID, videoId],
          })
          onClose()
        },
      }
    )
  }

  return (
    <Dialog
      open={version !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(null)
          onClose()
        }
      }}>
      <DialogContent className='max-w-md'>
        <form
          className='grid gap-4'
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}>
          <DialogHeader>
            <DialogTitle>Make Version {version} the Default?</DialogTitle>
            <DialogDescription>
              Everyone who plays this song will get these lyrics. You can switch
              back at any time.
            </DialogDescription>
          </DialogHeader>
          {error !== null && (
            <p role='alert' className='text-sm text-error'>
              {error}
            </p>
          )}
          <DialogFooter gap='md'>
            <Button type='button' variant='ghost' onClick={onClose}>
              Cancel
            </Button>
            <Button type='submit' disabled={isPending}>
              {isPending ? 'Saving…' : 'Make Default'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const VersionsAdmin = ({ videoId }: { videoId: string }) => {
  const { data, error, isLoading } = useGetLyricsVersions(videoId)
  const { data: songInfo } = useGetSongInfoBySongId(videoId)
  const [confirming, setConfirming] = useState<number | null>(null)
  const versions = data ? data.versions.toReversed() : []

  const regenerate = (skipUploaderLyrics: boolean) => {
    void startFromButton({
      mode: 'regenerate',
      skipUploaderLyrics,
      title: songInfo?.title,
      videoId,
    })
  }

  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-6 overflow-y-auto px-4 pt-page-top pb-page-bottom-lg'>
      <title>Lyrics Versions · Synbox</title>
      <Link
        to={`/v/${videoId}`}
        className='-my-2.5 flex w-fit items-center gap-1.5 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground'>
        <ArrowLeftIcon className='size-4' />
        Back to Song
      </Link>

      <header className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
        <div className='min-w-0 space-y-1'>
          <h1 className='text-2xl font-bold text-foreground'>
            Lyrics Versions
          </h1>
          <p className='truncate text-sm text-muted-foreground'>
            {songInfo?.title ?? videoId}
          </p>
        </div>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button gap='sm' className='w-fit shrink-0'>
              Regenerate
              <ChevronDownIcon className='size-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-72'>
            <DropdownMenuItem
              variant='stacked'
              onSelect={() => {
                regenerate(false)
              }}>
              <span>Regenerate</span>
              <span className='text-xs text-muted-foreground'>
                A fresh run with every lyrics source
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              variant='stacked'
              onSelect={() => {
                regenerate(true)
              }}>
              <span>Regenerate Without Uploader Lyrics</span>
              <span className='text-xs text-muted-foreground'>
                For when the video&apos;s subtitles are wrong
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <p className='-mt-2 text-sm text-muted-foreground'>
        Each regeneration is saved as a new version and becomes the default.
        Make an older one the default to roll back.
      </p>

      {isLoading && (
        <div className='flex flex-col gap-3'>
          <Skeleton shape='card' className='h-28' />
          <Skeleton shape='card' className='h-28' />
        </div>
      )}
      {error && (
        <p role='alert' className='text-sm text-error'>
          {error.message}
        </p>
      )}
      {data?.versions.length === 0 && (
        <p className='rounded-xl border border-dashed border-input p-6 text-center text-sm text-muted-foreground'>
          No versions yet. The first regeneration also keeps the current lyrics
          as the original version.
        </p>
      )}
      {versions.length > 0 && (
        <ul className='flex flex-col gap-3'>
          {versions.map((version) => (
            <VersionCard
              key={version.version}
              videoId={videoId}
              version={version}
              isDefault={data?.active === version.version}
              onMakeDefault={() => {
                setConfirming(version.version)
              }}
            />
          ))}
        </ul>
      )}

      <MakeDefaultDialog
        videoId={videoId}
        version={confirming}
        onClose={() => {
          setConfirming(null)
        }}
      />
    </div>
  )
}

// Versions are an admin tool: anyone else gets a 403, once the sign-in check has answered
const VersionsPage = () => {
  const { videoId = '' } = useParams<{ videoId: string }>()
  const { admin, ready } = useAccess()
  if (!ready) {
    return null
  }
  return admin ? <VersionsAdmin videoId={videoId} /> : <Forbidden />
}

export default VersionsPage
