import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  BookmarkCheckIcon,
  BookmarkIcon,
  LanguagesIcon,
  MessageSquareTextIcon,
  ReplyIcon,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useParams } from 'react-router'

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
  playerChromeOpenAtom,
  lyricsStylePanelAtom,
} from '@/context/atoms'
import { cn } from '@/utils/cn'

import { LyricsThemePicker } from './LyricsThemePicker'
import { LyricsVersionsMenu } from './LyricsVersionsMenu'
import { RailButton, RailTooltip, RailTooltipsOff } from './RailButton'

// The pointer has to rest on the rail this long before the style panel peeks open, so crossing it does not
const PEEK_DELAY_MS = 150
// Grace after the pointer leaves the rail and the panel, so the gap between them can be crossed
const PEEK_LEAVE_MS = 300

// Hovering the rail peeks the style panel open, so the lyrics' look is found without hunting for it. A
// panel closed while the pointer is on the rail or panel (a pick, a click elsewhere) stays closed until the
// pointer has left the rail once
const usePeek = () => {
  const [panel, setPanel] = useAtom(lyricsStylePanelAtom)
  const insideRef = useRef(false)
  const armedRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (panel === 'closed' && insideRef.current) {
      armedRef.current = false
    }
  }, [panel])
  useEffect(
    () => () => {
      clearTimeout(timerRef.current)
      setPanel('closed')
    },
    [setPanel]
  )

  const enter = (fromRail: boolean) => {
    insideRef.current = true
    clearTimeout(timerRef.current)
    if (fromRail && armedRef.current && panel === 'closed') {
      timerRef.current = setTimeout(() => {
        setPanel((current) => (current === 'closed' ? 'peek' : current))
      }, PEEK_DELAY_MS)
    }
  }
  const leave = (fromRail: boolean) => {
    insideRef.current = false
    if (fromRail) {
      armedRef.current = true
    }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setPanel((current) => (current === 'peek' ? 'closed' : current))
    }, PEEK_LEAVE_MS)
  }
  return { enter, leave, panelOpen: panel !== 'closed' }
}

const Divider = () => <div className='my-0.5 h-px w-6 bg-white/15' />

const PlayerRail = () => {
  const { videoId = '' } = useParams<{ videoId: string }>()
  const { toast } = useToast()
  const panelRef = useRef<HTMLElement>(null)
  const open = useAtomValue(playerChromeOpenAtom)
  const peek = usePeek()

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
    // Hoverable tooltips wait for a pointer move to close after the trigger is left, and none comes once
    // the pointer is outside the window or over the YouTube iframe, so the label outlived the hidden rail
    <TooltipProvider delayDuration={190} disableHoverableContent>
      <RailTooltipsOff value={peek.panelOpen}>
        <div className='pointer-events-none fixed top-1/2 left-0 z-50 -translate-y-1/2'>
          <nav
            ref={panelRef}
            data-player-chrome
            aria-label='Player Controls'
            onPointerEnter={() => {
              peek.enter(true)
            }}
            onPointerLeave={() => {
              peek.leave(true)
            }}
            className={cn(
              'flex flex-col items-center gap-1 rounded-r-2xl border border-l-0 border-white/10 bg-black/55 p-1.5 shadow-[0_8px_24px_rgb(0_0_0/0.4)] backdrop-blur-md transition-transform duration-300 ease-out',
              open ? 'pointer-events-auto translate-x-0' : '-translate-x-full'
            )}>
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
              label={
                showTranslation ? 'Hide Translations' : 'Show Translations'
              }>
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
            <LyricsThemePicker
              anchorRef={panelRef}
              onPointerEnter={() => {
                peek.enter(false)
              }}
              onPointerLeave={() => {
                peek.leave(false)
              }}
            />
            {videoId !== '' && <LyricsVersionsMenu videoId={videoId} />}

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
        </div>
      </RailTooltipsOff>
    </TooltipProvider>
  )
}

export default PlayerRail
