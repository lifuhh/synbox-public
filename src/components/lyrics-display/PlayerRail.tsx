import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  BookmarkCheckIcon,
  BookmarkIcon,
  HouseIcon,
  LanguagesIcon,
  MessageSquareTextIcon,
  ReplyIcon,
} from 'lucide-react'
import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { ToastAction } from '@/components/ui/toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/use-toast'
import {
  addFavoriteAtom,
  currentVideoAtom,
  isFavoriteAtom,
  lyricsVisibilityAtom,
  removeFavoriteAtom,
  romajiVisibilityAtom,
  translationIsEnglishAtom,
  translationVisibilityAtom,
} from '@/context/atoms'
import { cn } from '@/utils/cn'

import { LyricsThemePicker } from './LyricsThemePicker'
import { LyricsVersionsMenu } from './LyricsVersionsMenu'
import { RailButton, RailTooltip } from './RailButton'

// Shown on arrival so the viewer knows it is there, then tucked away
const FIRST_SHOW_MS = 3000
// Grace after the pointer leaves, so a brief overshoot does not hide it
const LEAVE_MS = 600
// Collapsed, the pointer has to come this close to the left edge to reveal it;
// open, it stays while the pointer is this close to the panel
const REVEAL_EDGE_PX = 24
const STAY_MARGIN_PX = 64

const near = (rect: DOMRect, x: number, y: number, margin: number) =>
  x >= rect.left - margin &&
  x <= rect.right + margin &&
  y >= rect.top - margin &&
  y <= rect.bottom + margin

// Open while the pointer is near the panel or `pinned` (a popover from it is
// open, or keyboard focus is inside it); otherwise it collapses LEAVE_MS after
// the pointer leaves. The test is geometric, from window pointer events, so
// the generous margin around the panel never swallows clicks on the video
const useEdgeReveal = (
  panelRef: RefObject<HTMLElement | null>,
  pinned: boolean
) => {
  const [open, setOpen] = useState(true)
  const openRef = useRef(open)
  const insideRef = useRef(false)
  const pinnedRef = useRef(pinned)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const collapseAfter = (ms: number) => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (!(insideRef.current || pinnedRef.current)) {
        openRef.current = false
        setOpen(false)
      }
    }, ms)
  }
  const reveal = () => {
    clearTimeout(timerRef.current)
    openRef.current = true
    setOpen(true)
  }

  useEffect(() => {
    if (pinnedRef.current === pinned) {
      return
    }
    pinnedRef.current = pinned
    if (pinned) {
      reveal()
    } else if (!insideRef.current) {
      collapseAfter(LEAVE_MS)
    }
  }, [pinned])

  useEffect(() => {
    collapseAfter(FIRST_SHOW_MS)
    const leave = () => {
      if (insideRef.current) {
        insideRef.current = false
        collapseAfter(LEAVE_MS)
      }
    }
    const track = (event: PointerEvent) => {
      const panel = panelRef.current
      if (!panel) {
        return
      }
      const rect = panel.getBoundingClientRect()
      const inside = openRef.current
        ? near(rect, event.clientX, event.clientY, STAY_MARGIN_PX)
        : event.clientX <= REVEAL_EDGE_PX &&
          near(rect, rect.left, event.clientY, STAY_MARGIN_PX)
      if (inside) {
        insideRef.current = true
        reveal()
      } else {
        leave()
      }
    }
    // The YouTube iframe (while interactive) and the world outside the window
    // send no pointer events, so entering either counts as leaving
    const out = (event: PointerEvent) => {
      if (
        event.relatedTarget === null ||
        event.relatedTarget instanceof HTMLIFrameElement
      ) {
        leave()
      }
    }
    window.addEventListener('pointermove', track)
    window.addEventListener('pointerdown', track)
    window.addEventListener('pointerout', out)
    return () => {
      clearTimeout(timerRef.current)
      window.removeEventListener('pointermove', track)
      window.removeEventListener('pointerdown', track)
      window.removeEventListener('pointerout', out)
    }
  }, [panelRef])

  return { open, reveal }
}

const Divider = () => <div className='my-0.5 h-px w-6 bg-white/15' />

const PlayerRail = () => {
  const navigate = useNavigate()
  const { videoId = '' } = useParams<{ videoId: string }>()
  const { toast } = useToast()
  const panelRef = useRef<HTMLElement>(null)
  const [styleOpen, setStyleOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  const { open, reveal } = useEdgeReveal(
    panelRef,
    styleOpen || versionsOpen || keyboardFocus
  )

  const currentVideo = useAtomValue(currentVideoAtom)
  const addFavorite = useSetAtom(addFavoriteAtom)
  const removeFavorite = useSetAtom(removeFavoriteAtom)
  const isFavorite = useAtomValue(isFavoriteAtom)
  const bookmarked = currentVideo ? isFavorite(currentVideo.videoId) : false

  const [showLyrics, setShowLyrics] = useAtom(lyricsVisibilityAtom)
  const [showRomaji, setShowRomaji] = useAtom(romajiVisibilityAtom)
  const [showTranslation, setShowTranslation] = useAtom(
    translationVisibilityAtom
  )
  const [english, setEnglish] = useAtom(translationIsEnglishAtom)

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast({ title: 'Copied URL to clipboard', duration: 1500 })
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to copy link to clipboard',
        variant: 'destructive',
        duration: 2000,
      })
    }
  }

  const handleBookmark = () => {
    if (!currentVideo) {
      return
    }
    const video = currentVideo
    if (bookmarked) {
      removeFavorite(video.videoId)
      toast({
        description: 'Removed Bookmark',
        action: (
          <ToastAction
            altText='Undo removal'
            onClick={() => {
              addFavorite(video)
            }}>
            Undo
          </ToastAction>
        ),
        duration: 5000,
      })
    } else {
      addFavorite(video)
      toast({
        description: 'Added to Bookmarks',
        action: (
          <ToastAction
            altText='Undo add'
            onClick={() => {
              removeFavorite(video.videoId)
            }}>
            Undo
          </ToastAction>
        ),
        duration: 5000,
      })
    }
  }

  const bookmarkLabel = (() => {
    if (!currentVideo) {
      return 'No Video Selected'
    }
    return bookmarked ? 'Remove from Bookmarks' : 'Add to Bookmarks'
  })()

  return (
    <TooltipProvider delayDuration={190}>
      <div className='pointer-events-none fixed top-1/2 left-0 z-50 -translate-y-1/2'>
        <nav
          ref={panelRef}
          aria-label='Player Controls'
          onFocus={(event) => {
            if (event.target.matches(':focus-visible')) {
              setKeyboardFocus(true)
            }
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setKeyboardFocus(false)
            }
          }}
          className={cn(
            'pointer-events-auto flex flex-col items-center gap-1 rounded-r-2xl border border-l-0 border-white/10 bg-black/55 p-1.5 shadow-[0_8px_24px_rgb(0_0_0/0.4)] backdrop-blur-md transition-transform duration-300 ease-out',
            open ? 'translate-x-0' : '-translate-x-full'
          )}>
          <RailTooltip label='Return to Home Page'>
            <RailButton
              label='Return to Home Page'
              onClick={() => {
                void navigate('/')
              }}>
              <HouseIcon className='size-5 shrink-0' />
            </RailButton>
          </RailTooltip>

          <Divider />

          <RailTooltip label={showLyrics ? 'Hide Lyrics' : 'Show Lyrics'}>
            <RailButton
              label='Lyrics'
              pressed={showLyrics}
              onClick={() => {
                setShowLyrics(!showLyrics)
              }}>
              <MessageSquareTextIcon className='size-5 shrink-0' />
            </RailButton>
          </RailTooltip>
          <RailTooltip label={showRomaji ? 'Hide Romaji' : 'Show Romaji'}>
            <RailButton
              label='Romaji'
              pressed={showRomaji}
              onClick={() => {
                setShowRomaji(!showRomaji)
              }}>
              <span className='text-base leading-none font-bold'>R</span>
            </RailButton>
          </RailTooltip>
          <RailTooltip
            label={showTranslation ? 'Hide Translations' : 'Show Translations'}>
            <RailButton
              label='Translations'
              pressed={showTranslation}
              onClick={() => {
                setShowTranslation(!showTranslation)
              }}>
              <LanguagesIcon className='size-5 shrink-0' />
            </RailButton>
          </RailTooltip>
          <RailTooltip
            label={
              english
                ? 'View Chinese Translations'
                : 'View English Translations'
            }>
            <RailButton
              label={
                english
                  ? 'View Chinese Translations'
                  : 'View English Translations'
              }
              onClick={() => {
                setEnglish(!english)
              }}>
              <span className='text-sm leading-none font-bold'>
                {english ? 'EN' : '中'}
              </span>
            </RailButton>
          </RailTooltip>
          <LyricsThemePicker onOpenChange={setStyleOpen} />
          {videoId !== '' && (
            <LyricsVersionsMenu
              videoId={videoId}
              onOpenChange={setVersionsOpen}
            />
          )}

          <Divider />

          <RailTooltip label={bookmarkLabel}>
            <RailButton
              label={bookmarkLabel}
              disabled={!currentVideo}
              onClick={handleBookmark}>
              {bookmarked ? (
                <BookmarkCheckIcon className='size-5 shrink-0 fill-current [&>path:last-child]:stroke-black' />
              ) : (
                <BookmarkIcon className='size-5 shrink-0 -scale-x-100' />
              )}
            </RailButton>
          </RailTooltip>
          <RailTooltip label='Copy URL'>
            <RailButton
              label='Copy URL'
              onClick={() => {
                void handleShare()
              }}>
              <ReplyIcon className='size-5 shrink-0 -scale-x-100' />
            </RailButton>
          </RailTooltip>
        </nav>

        {/* Where the panel went; tapping it reveals the panel on touch */}
        <button
          type='button'
          tabIndex={-1}
          aria-hidden='true'
          onClick={reveal}
          className={cn(
            'absolute top-1/2 left-0 grid h-16 w-4 -translate-y-1/2 place-items-center transition-opacity duration-300',
            open ? 'pointer-events-none opacity-0' : 'pointer-events-auto'
          )}>
          <span className='h-12 w-1 rounded-r-full bg-white/35' />
        </button>
      </div>
    </TooltipProvider>
  )
}

export default PlayerRail
