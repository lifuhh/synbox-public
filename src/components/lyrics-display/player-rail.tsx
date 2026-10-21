import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  BookOpenTextIcon,
  BookmarkCheckIcon,
  BookmarkIcon,
  LanguagesIcon,
  MessageSquareTextIcon,
  Share2Icon,
  ShareIcon,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
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
  playerChromeOpenAtom,
  lyricsStyleAtom,
  lyricsStylePanelAtom,
} from '@/context/atoms'
import { useArmed } from '@/hooks/use-armed'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useAccess } from '@/lib/auth'
import type { LyricsStyle } from '@/lib/lyrics-style'
import {
  DEFAULT_LYRICS_STYLE,
  encodeSharedStyle,
  sameLyricsStyle,
} from '@/lib/lyrics-style'
import { cn } from '@/utils/cn'

import { LyricsThemePicker } from './lyrics-theme-picker'
import { LyricsVersionsMenu } from './lyrics-versions-menu'
import {
  RailButton,
  RailInline,
  RailTooltip,
  RailTooltipsOff,
} from './rail-button'

// The pointer has to rest on the style button this long before the panel peeks open, so crossing it does not
const PEEK_DELAY_MS = 150
// Grace after the pointer leaves the button and the panel, so the gap between them can be crossed
const PEEK_LEAVE_MS = 300

// Hovering the style button peeks its panel open; the rail's other buttons only show their tooltips. A
// panel closed while the pointer is on the button or panel (a pick, a click elsewhere) stays closed until
// the pointer has left the button once
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

  const enter = (fromButton: boolean) => {
    insideRef.current = true
    clearTimeout(timerRef.current)
    if (fromButton && armedRef.current && panel === 'closed') {
      timerRef.current = setTimeout(() => {
        setPanel((current) => (current === 'closed' ? 'peek' : current))
      }, PEEK_DELAY_MS)
    }
  }
  const leave = (fromButton: boolean) => {
    insideRef.current = false
    if (fromButton) {
      armedRef.current = true
    }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setPanel((current) => (current === 'peek' ? 'closed' : current))
    }, PEEK_LEAVE_MS)
  }
  return { enter, leave, panelOpen: panel !== 'closed' }
}

// Each platform's own share glyph: the box and arrow on Apple devices, the three linked dots elsewhere
const PlatformShareIcon = /Mac|iPhone|iPad/u.test(navigator.userAgent)
  ? ShareIcon
  : Share2Icon

// The song's link, carrying the lyrics style it is being watched with, so it opens looking the same.
// Nothing to carry while the style is still the app's own
const shareUrl = (style: LyricsStyle) => {
  const url = new URL(window.location.href)
  if (sameLyricsStyle(style, DEFAULT_LYRICS_STYLE)) {
    url.searchParams.delete('style')
  } else {
    url.searchParams.set('style', encodeSharedStyle(style))
  }
  return url
}

const Divider = ({ inline }: { inline: boolean }) => (
  <div
    className={cn(
      'shrink-0 bg-white/15',
      inline
        ? 'h-6 w-px'
        : 'my-0.5 h-px w-6 portrait:my-0 portrait:h-6 portrait:w-px'
    )}
  />
)

const railClass = (inline: boolean, interactive: boolean, open: boolean) =>
  inline
    ? 'no-scrollbar flex items-center gap-1 overflow-x-auto rounded-2xl bg-card p-1'
    : cn(
        'flex flex-col items-center gap-1 rounded-r-2xl bg-black/55 p-1.5 shadow-rail backdrop-blur-md transition-translate-fade duration-300 ease-out',
        'portrait:no-scrollbar portrait:max-w-[calc(100vw-0.5rem)] portrait:flex-row portrait:gap-1 portrait:overflow-x-auto portrait:rounded-2xl portrait:p-1',
        'short:gap-1 short:p-1',
        interactive && 'pointer-events-auto',
        // Past the notch inset too, or a phone on its side shows the rail's edge beside it
        open
          ? 'translate-x-0'
          : '-translate-x-[calc(100%+var(--safe-left))] portrait:translate-x-0 portrait:opacity-0'
      )

// The player's own buttons: the lyrics toggles and style, versions (admins), bookmark, share and Read Lyrics.
// Floating, it is the stage's rail that shows and hides with the rest of its UI. Inline, it is a row under the
// video on the watch page, always there
const PlayerRail = ({ inline = false }: { inline?: boolean }) => {
  const { videoId = '' } = useParams<{ videoId: string }>()
  const navigate = useNavigate()
  const { admin } = useAccess()
  const { toast } = useToast()
  const panelRef = useRef<HTMLElement>(null)
  const open = useAtomValue(playerChromeOpenAtom)
  const armed = useArmed(open)
  const peek = usePeek()

  // Published so that in portrait, where the rail sits on the control bar, the notices, the lyrics and
  // the generation button stay above it
  useEffect(() => {
    const observe = (panel: HTMLElement) => {
      const root = document.documentElement
      const observer = new ResizeObserver(() => {
        root.style.setProperty('--player-rail-h', `${panel.offsetHeight}px`)
      })
      observer.observe(panel)
      return () => {
        observer.disconnect()
        root.style.removeProperty('--player-rail-h')
      }
    }
    const panel = panelRef.current
    return panel && !inline ? observe(panel) : undefined
  }, [inline])

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
  const touch = useMediaQuery('(pointer: coarse)')
  const nativeShare = touch && 'share' in navigator
  const shareLabel = nativeShare ? 'Share' : 'Copy Link'
  const lyricsStyle = useAtomValue(lyricsStyleAtom)

  const handleShare = async () => {
    const url = shareUrl(lyricsStyle)
    // Phones share through the system sheet; an installed app has no address bar to copy from
    if (nativeShare) {
      try {
        await navigator.share({
          title: currentVideo?.title ?? 'Synbox',
          url: url.href,
        })
      } catch (error) {
        // Closing the sheet rejects with AbortError, which is not a failure
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          toast({
            description: 'Failed to share link',
            duration: 2000,
            title: 'Error',
            variant: 'destructive',
          })
        }
      }
      return
    }
    try {
      await navigator.clipboard.writeText(url.href)
      toast({
        description: url.searchParams.has('style')
          ? 'Opens with your lyrics style'
          : undefined,
        duration: 2000,
        title: 'Link Copied',
      })
    } catch {
      toast({
        description: 'Failed to copy link to clipboard',
        duration: 2000,
        title: 'Error',
        variant: 'destructive',
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
        action: (
          <ToastAction
            altText='Undo removal'
            onClick={() => {
              addFavorite(video)
            }}>
            Undo
          </ToastAction>
        ),
        description: 'Removed Bookmark',
        duration: 5000,
      })
    } else {
      addFavorite(video)
      toast({
        action: (
          <ToastAction
            altText='Undo add'
            onClick={() => {
              removeFavorite(video.videoId)
            }}>
            Undo
          </ToastAction>
        ),
        description: 'Added to Bookmarks',
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
      <RailInline value={inline}>
        <RailTooltipsOff value={peek.panelOpen}>
          {/* Left edge, vertically centred; in portrait a row on the control bar, in thumb reach; on a phone
            on its side a compact column under the top bar, with the control bar starting to its right */}
          <div
            className={
              inline
                ? 'min-w-0'
                : 'pointer-events-none fixed top-1/2 left-(--safe-left) z-50 -translate-y-1/2 portrait:top-auto portrait:bottom-[var(--stage-controls-h,5rem)] portrait:left-1/2 portrait:-translate-x-1/2 portrait:translate-y-0 short:top-[calc(var(--topbar-h)+0.25rem)] short:translate-y-0'
            }>
            <nav
              ref={panelRef}
              data-player-chrome={inline ? undefined : true}
              aria-label='Player Controls'
              className={railClass(inline, open && armed, open)}>
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
              <LyricsThemePicker anchorRef={panelRef} peek={peek} />
              {admin && videoId !== '' && (
                <LyricsVersionsMenu videoId={videoId} />
              )}

              <Divider inline={inline} />

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
              <RailTooltip label={shareLabel}>
                <RailButton
                  label={shareLabel}
                  onClick={() => {
                    void handleShare()
                  }}>
                  <PlatformShareIcon className='size-5 shrink-0' />
                </RailButton>
              </RailTooltip>
              {/* The song's lyrics as a page to read or play along without the video */}
              <RailTooltip label='Read Lyrics'>
                <RailButton
                  label='Read Lyrics'
                  disabled={videoId === ''}
                  onClick={() => {
                    void navigate(`/lyrics/${videoId}`)
                  }}>
                  <BookOpenTextIcon className='size-5 shrink-0' />
                </RailButton>
              </RailTooltip>
            </nav>
          </div>
        </RailTooltipsOff>
      </RailInline>
    </TooltipProvider>
  )
}

export default PlayerRail
