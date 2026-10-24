import { ArrowUpRightIcon } from 'lucide-react'
import { Link } from 'react-router'

import { YouTubeIcon } from '@/components/svgicons'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useYoutubeVideo } from '@/lib/react-query/queries-and-mutations'
import { mightBeJapaneseSong } from '@/lib/youtube/song-guess'
import { bracketStart } from '@/utils'
import { cn } from '@/utils/cn'

import { GenerateLyricsButton, useGenerating } from './generate-lyrics-button'

// A /v/ link to a video that isn't a Synbox song. The player doesn't play it: Synbox is not a YouTube player.
// It shows which video the link is, and a Japanese song can be generated from here; when it finishes, its lyrics
// row appears and the page becomes the player (player-page.tsx › useSongPresence)
export const NotInLibrary = ({ videoId }: { videoId: string }) => {
  const { data: video, isPending } = useYoutubeVideo(videoId)
  const generating = useGenerating(videoId)
  const offer =
    generating || (video !== undefined && mightBeJapaneseSong(video))
  return (
    <div className='flex min-h-(--app-h) w-full flex-col items-center justify-center gap-6 px-4 pt-16 pb-8 text-center short:flex-row short:gap-8 short:text-left'>
      <title>Not on Synbox · Synbox</title>
      <div className='flex w-full max-w-sm min-w-0 flex-col gap-3 short:max-w-64'>
        {isPending ? (
          <Skeleton shape='card' className='aspect-video w-full' />
        ) : (
          video !== undefined && (
            <img
              src={video.thumbnail}
              alt=''
              className='aspect-video w-full rounded-xl bg-card object-cover'
            />
          )
        )}
        {video !== undefined && (
          <div className='min-w-0'>
            <p
              className={cn(
                'line-clamp-2 text-sm font-semibold text-pretty text-foreground',
                bracketStart(video.title)
              )}>
              {video.title}
            </p>
            <p className='truncate text-sm text-muted-foreground'>
              {video.channelTitle}
            </p>
          </div>
        )}
      </div>
      <div className='flex flex-col items-center gap-4 short:items-start'>
        <div className='flex flex-col gap-1'>
          <h1 className='text-xl font-semibold text-foreground'>
            {offer ? 'Not on Synbox Yet' : 'Not on Synbox'}
          </h1>
          {!offer && !isPending && (
            <p className='text-sm text-muted-foreground'>Japanese songs only</p>
          )}
        </div>
        <div className='flex flex-wrap items-center justify-center gap-2'>
          {offer && video !== undefined && (
            <GenerateLyricsButton videoId={videoId} title={video.title} />
          )}
          <Button asChild variant={offer ? 'outline' : 'default'}>
            <Link to='/'>Go Home</Link>
          </Button>
          {video !== undefined && (
            <Button asChild variant='ghost' gap='md'>
              <a
                href={`https://www.youtube.com/watch?v=${videoId}`}
                target='_blank'
                rel='noreferrer'
                aria-label='Open on YouTube'>
                <YouTubeIcon aria-hidden className='h-3.5 w-auto shrink-0' />
                YouTube
                <ArrowUpRightIcon
                  aria-hidden
                  className='size-4 shrink-0 text-muted-foreground'
                />
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
