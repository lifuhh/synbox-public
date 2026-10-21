import { useCallback, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { PlayerStage } from '@/components/player-stage/player-stage'
import { StageLyrics } from '@/components/player-stage/stage-lyrics'
import type { YouTubeQuirks } from '@/components/player-stage/youtube-quirks'
import { DEFAULT_YOUTUBE_QUIRKS } from '@/components/player-stage/youtube-quirks'
import { useGetLyricsVersions } from '@/lib/react-query/queries-and-mutations'

const DEFAULT_VIDEO_ID = '6rG_irmOQsM'
const LOG_LIMIT = 80

type BooleanQuirk = {
  [K in keyof YouTubeQuirks]: YouTubeQuirks[K] extends boolean ? K : never
}[keyof YouTubeQuirks]
type NumberQuirk = Exclude<keyof YouTubeQuirks, BooleanQuirk>

const BOOLEAN_QUIRKS: { key: BooleanQuirk; label: string }[] = [
  { key: 'blockIframeInput', label: 'Block Iframe Input' },
  { key: 'unloadCaptions', label: 'Unload Captions' },
]
const NUMBER_QUIRKS: { key: NumberQuirk; label: string; step: number }[] = [
  { key: 'cropPx', label: 'Crop (px)', step: 5 },
  { key: 'coverHoldMs', label: 'Cover Hold (ms)', step: 25 },
  { key: 'endGuardSec', label: 'End Guard (s)', step: 0.1 },
]

const CHECKS = [
  'Hover the video: no YouTube title bar or logo',
  'Pause (click, space, k): the frame stays with our play button; nothing from YouTube',
  'Resume or seek: no title flash or top shade; our center button hides with the rest of the controls',
  'Seek to the last seconds: stops with a replay cover, no end screen',
  'Volume slider, mute, arrow keys: change sticks, survives reload',
  'A video with auto-captions: none visible; untick Unload Captions to compare',
  'Drag the lyrics over the video and out past the edges',
  'Click the lyrics without dragging: nothing happens; beside them: pauses',
]

const StageLabPage = () => {
  const [params, setParams] = useSearchParams()
  const videoId = params.get('v') ?? DEFAULT_VIDEO_ID
  const versionParam = params.get('version')
  const version = versionParam === null ? null : Number(versionParam)
  const { data: versions } = useGetLyricsVersions(videoId)
  const [draftId, setDraftId] = useState(videoId)
  const [quirks, setQuirks] = useState(DEFAULT_YOUTUBE_QUIRKS)
  const [log, setLog] = useState<string[]>([])
  const startRef = useRef<number | null>(null)

  const handleEvent = useCallback((message: string) => {
    const start = startRef.current ?? performance.now()
    startRef.current = start
    const at = ((performance.now() - start) / 1000).toFixed(2)
    setLog((current) => [`${at}s  ${message}`, ...current].slice(0, LOG_LIMIT))
  }, [])

  return (
    <div className='flex h-screen w-full bg-black text-lab-foreground'>
      <div className='min-w-0 flex-1'>
        <PlayerStage
          key={videoId}
          videoId={videoId}
          quirks={quirks}
          onEvent={handleEvent}
          renderLyrics={(player, layout) => (
            <StageLyrics
              videoId={videoId}
              player={player}
              layout={layout}
              version={version}
              placeholder='ドラッグして<ruby>移動<rt>いどう</rt></ruby>'
            />
          )}
        />
      </div>

      <aside className='flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-white/10 bg-stage p-4 text-sm'>
        <h1 className='text-base font-semibold text-white'>Player Stage Lab</h1>

        <form
          className='flex gap-2'
          onSubmit={(event) => {
            event.preventDefault()
            setLog([])
            setParams({ v: draftId.trim() })
          }}>
          <input
            aria-label='Video ID'
            value={draftId}
            onChange={(event) => {
              setDraftId(event.target.value)
            }}
            className='min-w-0 flex-1 rounded-md border border-white/15 bg-black px-2 py-1 font-mono'
          />
          <button
            type='submit'
            className='rounded-md bg-primary px-3 py-1 font-medium text-white'>
            Load
          </button>
        </form>

        <label className='flex flex-col gap-1'>
          <span className='font-semibold text-white'>Lyrics Version</span>
          <select
            value={versionParam ?? 'active'}
            onChange={(event) => {
              const next = event.target.value
              setParams(
                next === 'active'
                  ? { v: videoId }
                  : { v: videoId, version: next }
              )
            }}
            className='rounded-md border border-white/15 bg-black px-2 py-1'>
            <option value='active'>
              Active
              {versions?.active === null || versions?.active === undefined
                ? ''
                : ` (v${versions.active})`}
            </option>
            {versions?.versions.map((entry) => (
              <option key={entry.version} value={String(entry.version)}>
                v{entry.version}: {entry.source}, {entry.summary.lines} lines
              </option>
            ))}
          </select>
        </label>

        <section className='flex flex-col gap-2'>
          <h2 className='font-semibold text-white'>Quirks</h2>
          {BOOLEAN_QUIRKS.map(({ key, label }) => (
            <label key={key} className='flex items-center gap-2'>
              <input
                type='checkbox'
                checked={quirks[key]}
                onChange={(event) => {
                  setQuirks({ ...quirks, [key]: event.target.checked })
                }}
              />
              {label}
            </label>
          ))}
          {NUMBER_QUIRKS.map(({ key, label, step }) => (
            <label
              key={key}
              className='flex items-center justify-between gap-2'>
              {label}
              <input
                type='number'
                step={step}
                min={0}
                value={quirks[key]}
                onChange={(event) => {
                  setQuirks({ ...quirks, [key]: Number(event.target.value) })
                }}
                className='w-20 rounded-md border border-white/15 bg-black px-2 py-0.5 text-right font-mono'
              />
            </label>
          ))}
          <button
            type='button'
            onClick={() => {
              setQuirks(DEFAULT_YOUTUBE_QUIRKS)
            }}
            className='self-start rounded-md border border-white/15 px-2 py-0.5'>
            Reset Quirks
          </button>
        </section>

        <section className='flex flex-col gap-1'>
          <h2 className='font-semibold text-white'>Checks</h2>
          <ol className='list-decimal space-y-1 pl-5 text-lab-muted'>
            {CHECKS.map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ol>
        </section>

        <section className='flex min-h-0 flex-col gap-1'>
          <h2 className='font-semibold text-white'>Player Events</h2>
          <pre
            data-testid='lab-log'
            className='max-h-72 overflow-y-auto rounded-md bg-black p-2 font-mono text-xs leading-relaxed text-lab-muted'>
            {log.join('\n')}
          </pre>
        </section>
      </aside>
    </div>
  )
}

export default StageLabPage
