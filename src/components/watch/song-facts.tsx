import { useAtomValue } from 'jotai'
import { ArrowUpRightIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'

import { YouTubeIcon } from '@/components/svgicons'
import { chartSongAtom, stageClockAtom } from '@/context/atoms'
import { useGetSongInfoBySongId } from '@/lib/react-query/queries-and-mutations'
import { compactCount, listensText, useSongStats } from '@/lib/song-stats'
import type { CssVars } from '@/types'
import { bracketStart } from '@/utils'
import { cn } from '@/utils/cn'

const ADDED = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
})

// "1 like", "1.2K likes"
const likesText = (likes: number) =>
  `${compactCount(likes)} ${likes === 1 ? 'like' : 'likes'}`

// The way to the video on YouTube, its logo alone at the end of the line. The song here stops while it plays there.
// A 40px target on the 20px line: the negative margins keep the line's height
const YouTubeLink = ({ videoId }: { videoId: string }) => {
  const clock = useAtomValue(stageClockAtom)
  return (
    <a
      href={`https://www.youtube.com/watch?v=${videoId}`}
      target='_blank'
      rel='noreferrer'
      aria-label='Open on YouTube'
      title='Open on YouTube'
      onClick={() => {
        clock?.pause()
      }}
      className='-my-2.5 flex h-10 shrink-0 items-center gap-1 rounded-full px-2 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'>
      <YouTubeIcon aria-hidden className='h-3.5 w-auto shrink-0' />
      <ArrowUpRightIcon
        aria-hidden
        className='size-3.5 shrink-0 text-muted-foreground'
      />
    </a>
  )
}

// What the line says after the channel: a chart song (in YouTube's Top 100 Japan, not yet in Synbox) where it came
// from; a library song how often it was played and liked, and when it came to Synbox. Nothing until the stats
// settle, so the line never jumps; a song no one liked says nothing about likes
const useFacts = (videoId: string) => {
  const chart = useAtomValue(chartSongAtom)
  const { data: stats, isPending } = useSongStats(videoId)
  const { data: info } = useGetSongInfoBySongId(videoId)
  if (chart?.videoId === videoId) {
    return [`#${chart.rank}`, 'YouTube Top 100 Japan']
  }
  if (isPending) {
    return []
  }
  const addedAt = info?.addedAt === undefined ? null : new Date(info.addedAt)
  return [
    stats && listensText(stats.listens),
    stats && stats.likes > 0 ? likesText(stats.likes) : undefined,
    addedAt !== null && !Number.isNaN(addedAt.getTime())
      ? `Added ${ADDED.format(addedAt)}`
      : undefined,
  ].filter((fact) => fact !== undefined)
}

// The fewest characters of the channel left before the facts give way
const CHANNEL_MIN_EM = 6

// Sets the facts' width to what fits, now and whenever the line or a fact changes size or a fact comes or goes
const watchFit = (
  lineEl: HTMLElement,
  boxEl: HTMLElement,
  setWidth: (width: number) => void
) => {
  const fit = () => {
    // oxlint-disable-next-line unicorn/prefer-number-coercion -- the value ends in px, which Number() rejects
    const em = Number.parseFloat(getComputedStyle(lineEl).fontSize)
    const room = lineEl.clientWidth - CHANNEL_MIN_EM * em
    let used = 0
    for (const fact of boxEl.children) {
      const next = used + fact.getBoundingClientRect().width
      if (next > room) {
        break
      }
      used = next
    }
    setWidth(Math.ceil(used))
  }
  const resize = new ResizeObserver(fit)
  const observe = () => {
    resize.disconnect()
    resize.observe(lineEl)
    for (const fact of boxEl.children) {
      resize.observe(fact)
    }
    fit()
  }
  // The facts arrive after the line (the stats load later), and each is a new element to watch
  const facts = new MutationObserver(observe)
  facts.observe(boxEl, {
    characterData: true,
    childList: true,
    subtree: true,
  })
  observe()
  return () => {
    facts.disconnect()
    resize.disconnect()
  }
}

// How many of the facts fit beside the channel, the channel kept to 6em at least: the facts' total width, in px.
// The facts are all laid out (the ones past it wrap out of sight), so each keeps a width to measure as the line
// grows, a fact changes or a font slice arrives
const useFactsWidth = () => {
  const line = useRef<HTMLParagraphElement>(null)
  const box = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const lineEl = line.current
    const boxEl = box.current
    return lineEl && boxEl ? watchFit(lineEl, boxEl, setWidth) : undefined
  }, [])
  return { box, line, width }
}

// The line under the song's title, as YouTube's: the channel, then the facts, muted, then YouTube's logo. One line
// at any width: the facts that fit beside 6em of channel show whole, the channel takes the rest and is cut with an
// ellipsis, and facts that don't fit go from the end (Added, then likes, then listens). Each fact carries its own
// dot, so a hidden one leaves none behind
export const SongMeta = ({
  videoId,
  author,
}: {
  videoId: string
  author: string
}) => {
  const facts = useFacts(videoId)
  const { box, line, width } = useFactsWidth()
  return (
    <div
      data-song-meta
      className='flex min-w-0 items-center gap-3 text-sm text-muted-foreground'>
      <p ref={line} className='flex min-w-0 flex-1'>
        <span
          className={cn('min-w-0 truncate font-medium', bracketStart(author))}>
          {author}
        </span>
        <span
          ref={box}
          style={
            width === null
              ? undefined
              : ({ '--facts-w': `${width}px` } as CssVars)
          }
          className={cn(
            'flex h-lh shrink-0 flex-wrap overflow-hidden tabular-nums',
            width !== null && 'w-(--facts-w)'
          )}>
          {facts.map((fact) => (
            <span
              key={fact}
              className='shrink-0 whitespace-nowrap before:mx-1.5 before:content-["·"]'>
              {fact}
            </span>
          ))}
        </span>
      </p>
      {videoId !== '' && <YouTubeLink videoId={videoId} />}
    </div>
  )
}
