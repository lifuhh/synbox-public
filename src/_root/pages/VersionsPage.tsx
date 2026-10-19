import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { startGeneration } from '@/lib/generation/store'
import {
  useActivateLyricsVersion,
  useGetLyricsVersions,
  useGetSongInfoBySongId,
} from '@/lib/react-query/queriesAndMutations'
import { QUERY_KEYS } from '@/lib/react-query/queryKeys'
import type { LyricsVersionSummary } from '@/lib/synbox-flask/lyrics-versions'

const TOKEN_KEY = 'synbox-admin-token'

const readToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

const saveToken = (token: string) => {
  try {
    sessionStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Private windows can refuse storage; the token then lasts until reload.
  }
}

const percent = (value: number | null) =>
  value === null ? '–' : `${Math.round(value * 100)}%`

const COLUMNS: [keyof LyricsVersionSummary['summary'], string][] = [
  ['timed', 'Timed'],
  ['english', 'English'],
  ['chinese', 'Chinese'],
  ['romaji', 'Romaji'],
  ['readings', 'Readings'],
]

const VersionsPage = () => {
  const { videoId = '' } = useParams<{ videoId: string }>()
  const queryClient = useQueryClient()
  const [adminToken, setAdminToken] = useState(readToken)
  const [actionError, setActionError] = useState<string | null>(null)
  const { data, error, isLoading } = useGetLyricsVersions(videoId)
  const { data: songInfo } = useGetSongInfoBySongId(videoId)
  const { isPending, mutate: activate } = useActivateLyricsVersion()

  const handleActivate = (version: number) => {
    setActionError(null)
    if (adminToken === '') {
      setActionError('Enter the admin token to change the default version.')
      return
    }
    saveToken(adminToken)
    activate(
      { adminToken, version, videoId },
      {
        onError: (activateError) => {
          setActionError(activateError.message)
        },
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: [QUERY_KEYS.GET_LYRICS_VERSIONS, videoId],
          })
          // The player's lyrics query never refetches on mount, so drop it to load the new default.
          queryClient.removeQueries({
            queryKey: [QUERY_KEYS.GET_LYRICS_BY_SONG_ID, videoId],
          })
        },
      }
    )
  }

  return (
    <div className='mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10'>
      <div className='flex flex-col gap-2 md:flex-row md:items-end md:justify-between'>
        <div>
          <h1 className='text-2xl font-bold text-foreground'>
            Lyrics Versions
          </h1>
          <p className='text-sm text-muted-foreground'>
            {songInfo?.title ?? videoId}
          </p>
        </div>
        <div className='flex gap-2'>
          <Button asChild variant='ghost'>
            <Link to={`/v/${videoId}`}>Open Song</Link>
          </Button>
          <Button
            onClick={() => {
              startGeneration({
                mode: 'regenerate',
                title: songInfo?.title,
                videoId,
              })
            }}>
            Regenerate
          </Button>
          <Button
            variant='outline'
            onClick={() => {
              startGeneration({
                mode: 'regenerate',
                skipUploaderLyrics: true,
                title: songInfo?.title,
                videoId,
              })
            }}>
            Regenerate Without Uploader Lyrics
          </Button>
        </div>
      </div>

      <p className='text-sm text-muted-foreground'>
        Regenerating saves a new version and makes it the default. Skip the
        uploader&apos;s lyrics when their subtitles are wrong; the lyrics then
        come from YouTube Music, LRCLIB or the audio. Making an older version
        the default rolls back.
      </p>

      <label
        htmlFor='admin-token'
        className='flex max-w-md flex-col gap-1 text-sm text-muted-foreground'>
        Admin Token
        <Input
          id='admin-token'
          type='password'
          autoComplete='off'
          value={adminToken}
          onChange={(event) => {
            setAdminToken(event.target.value)
          }}
        />
      </label>

      {actionError !== null && (
        <p role='alert' className='text-sm font-semibold text-foreground'>
          {actionError}
        </p>
      )}
      {isLoading && <p className='text-muted-foreground'>Loading Versions…</p>}
      {error && (
        <p role='alert' className='font-semibold text-foreground'>
          {error.message}
        </p>
      )}
      {data?.versions.length === 0 && (
        <p className='text-muted-foreground'>
          No versions yet. The first regeneration also saves today&apos;s lyrics
          as Version 0.
        </p>
      )}

      {data && data.versions.length > 0 && (
        <div className='overflow-x-auto rounded-md border border-accent'>
          <table className='w-full text-left text-sm tabular-nums'>
            <thead className='bg-card text-muted-foreground'>
              <tr>
                <th className='p-3'>Version</th>
                <th className='p-3'>Source</th>
                <th className='p-3'>Created</th>
                <th className='p-3 text-right'>Lines</th>
                {COLUMNS.map(([key, label]) => (
                  <th key={key} className='p-3 text-right'>
                    {label}
                  </th>
                ))}
                <th className='p-3'>Status</th>
                <th className='p-3'>
                  <span className='sr-only'>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.versions.map((version) => {
                const isActive = data.active === version.version
                return (
                  <tr
                    key={version.version}
                    className='border-t border-accent text-foreground'>
                    <td className='p-3'>{version.version}</td>
                    <td className='p-3' title={version.note}>
                      {version.source}
                    </td>
                    <td className='p-3'>{version.created_at.slice(0, 10)}</td>
                    <td className='p-3 text-right'>{version.summary.lines}</td>
                    {COLUMNS.map(([key]) => (
                      <td key={key} className='p-3 text-right'>
                        {percent(version.summary[key])}
                      </td>
                    ))}
                    <td className='p-3'>{isActive ? 'Default' : ''}</td>
                    <td className='flex gap-2 p-3'>
                      <Button asChild size='sm' variant='ghost'>
                        <Link to={`/v/${videoId}?version=${version.version}`}>
                          Preview
                        </Link>
                      </Button>
                      {!isActive && (
                        <Button
                          size='sm'
                          disabled={isPending}
                          onClick={() => {
                            handleActivate(version.version)
                          }}>
                          Make Default
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default VersionsPage
