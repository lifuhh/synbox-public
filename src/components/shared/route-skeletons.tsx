import { LoaderIcon } from 'lucide-react'
import { useLayoutEffect, useState } from 'react'
import { useParams } from 'react-router'

import { Skeleton } from '@/components/ui/skeleton'
import { useMediaQuery } from '@/hooks/use-media-query'

// What a page shows while its code is still on its way (a route's Suspense fallback, app.tsx): the app's frame (top
// bar, tabs) stays, and only the page's own place holds a placeholder shaped like it, never a blank or a word. Small
// and in the first bundle, so the fallback itself never waits

// Read by screen readers once; nothing to see
const Busy = () => <span className='sr-only'>Loading</span>

// A page that scrolls the document as a whole (doc-scroll.tsx › DocScroll) lays out a scrollbar's gutter narrower:
// its placeholder claims the same before paint, so the page taking over moves nothing. Left on for the page that
// arrives at the same address (its DocScroll owns it from there); dropped if the visitor went elsewhere first
const useDocScroll = (on: boolean) => {
  useLayoutEffect(() => {
    const root = document.documentElement
    const at = window.location.pathname
    if (on) {
      root.toggleAttribute('data-doc-scroll', true)
    }
    return () => {
      if (on && window.location.pathname !== at) {
        delete root.dataset.docScroll
      }
    }
  }, [on])
}

// The player page's frame as it first draws while checking the video (watch-page.tsx › WatchPage with `loading`,
// player-stage.tsx › StagePlaceholder): the same boxes, picture and spinner, so the page taking over changes nothing.
// A phone on its side shows the stage alone, as the player does
const PHONE_ON_ITS_SIDE = '(orientation: landscape) and (max-height: 500px)'
const WIDE = '(min-width: 1000px)'

const StageCoverSkeleton = ({ videoId }: { videoId: string }) => {
  const [thumb, setThumb] = useState('maxresdefault')
  return (
    <div className='grid size-full place-items-center'>
      <div className='relative aspect-video h-full max-w-full'>
        <div className='pointer-events-none absolute inset-0 z-10 grid place-items-center overflow-hidden bg-black'>
          {videoId !== '' && (
            <img
              src={`https://i.ytimg.com/vi/${videoId}/${thumb}.jpg`}
              alt=''
              onError={() => {
                setThumb('hqdefault')
              }}
              className='absolute inset-0 size-full object-cover'
            />
          )}
          <div className='relative text-white drop-shadow-stage'>
            <LoaderIcon className='size-14 animate-spin' />
          </div>
        </div>
      </div>
    </div>
  )
}

export const PlayerSkeleton = () => {
  const { videoId = '' } = useParams()
  useDocScroll(true)
  const onItsSide = useMediaQuery(PHONE_ON_ITS_SIDE)
  const wide = useMediaQuery(WIDE)
  if (onItsSide) {
    return (
      <div data-route-skeleton='player' aria-busy className='size-full'>
        <StageCoverSkeleton videoId={videoId} />
        <Busy />
      </div>
    )
  }
  return (
    <div data-route-skeleton='player' aria-busy className='watch-page'>
      <div className='watch-stage'>
        <StageCoverSkeleton videoId={videoId} />
      </div>
      {wide ? (
        <>
          <div className='watch-side'>
            <Skeleton shape='card' className='absolute inset-0' />
          </div>
          <div className='flex watch-main flex-col gap-2 pt-2'>
            <Skeleton className='h-7 w-2/3' />
            <Skeleton className='h-4 w-1/4' />
          </div>
        </>
      ) : (
        <div className='flex flex-col gap-2 px-4 pt-4'>
          <Skeleton className='h-5 w-3/4' />
          <Skeleton className='h-4 w-1/3' />
        </div>
      )}
      <Busy />
    </div>
  )
}

// The pages' common frame (Search, Library, You, the playlists, About and the legal pages): under the top bar, the
// page's side gutters, above the tabs
const PAGE_FRAME =
  'flex flex-1 flex-col overflow-y-auto pt-(--topbar-h) page-x pb-page-bottom'

// A list page: its title, then rows of a thumbnail and two lines
export const ListPageSkeleton = ({ docScroll }: { docScroll: boolean }) => {
  useDocScroll(docScroll)
  return (
    <div data-route-skeleton='list' aria-busy className={PAGE_FRAME}>
      <div className='mx-auto flex w-full max-w-2xl flex-col gap-5 pt-6'>
        <Skeleton className='h-8 w-40' />
        <div className='flex flex-col gap-3'>
          {Array.from({ length: 6 }, (_, row) => (
            <div key={row} className='flex items-center gap-3'>
              <Skeleton
                shape='thumbnail'
                className='aspect-video w-24 shrink-0'
              />
              <div className='flex flex-1 flex-col gap-2'>
                <Skeleton className='h-4 w-4/5' />
                <Skeleton className='h-3 w-1/3' />
              </div>
            </div>
          ))}
        </div>
      </div>
      <Busy />
    </div>
  )
}

// A reading page (About, Privacy, Terms, a song's lyrics): a centred title over paragraphs in the reading column
export const TextPageSkeleton = ({ docScroll }: { docScroll: boolean }) => {
  useDocScroll(docScroll)
  return (
    <div data-route-skeleton='text' aria-busy className={PAGE_FRAME}>
      <div className='mx-auto flex w-full max-w-[42rem] flex-col gap-6 pt-8'>
        <div className='flex flex-col items-center gap-3'>
          <Skeleton className='h-9 w-48' />
          <Skeleton className='h-4 w-72 max-w-full' />
        </div>
        {Array.from({ length: 3 }, (_, block) => (
          <div key={block} className='flex flex-col gap-2'>
            <Skeleton className='h-4 w-full' />
            <Skeleton className='h-4 w-11/12' />
            <Skeleton className='h-4 w-3/5' />
          </div>
        ))}
      </div>
      <Busy />
    </div>
  )
}
