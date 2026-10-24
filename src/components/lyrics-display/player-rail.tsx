import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  BookOpenTextIcon,
  ListPlusIcon,
  BookmarkCheckIcon,
  BookmarkIcon,
  EllipsisIcon,
  FlagIcon,
  LanguagesIcon,
  LoaderCircleIcon,
  MessageSquareTextIcon,
  Share2Icon,
  ShareIcon,
  SparklesIcon,
  ThumbsUpIcon,
  TicketIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { useOpenRequestInvite } from '@/components/invite/request-invite'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ToastAction } from '@/components/ui/toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/use-toast'
import {
  GENERATE_LABELS,
  startGenerating,
  useGenerationPhase,
  useRequestInsteadOfGenerating,
} from '@/components/watch/generate-lyrics-button'
import { SaveToPlaylist } from '@/components/watch/save-to-playlist'
import {
  chartSongAtom,
  currentVideoAtom,
  lyricsVisibilityAtom,
  romajiVisibilityAtom,
  translationIsEnglishAtom,
  translationVisibilityAtom,
  playerChromeOpenAtom,
  lyricsStyleAtom,
  lyricsStylePanelAtom,
} from '@/context/atoms'
import { useArmed } from '@/hooks/use-armed'
import { useMediaQuery, usePortrait } from '@/hooks/use-media-query'
import { signInWithGoogle, useAccess } from '@/lib/auth'
import {
  addFavoriteAtom,
  isFavoriteAtom,
  removeFavoriteAtom,
} from '@/lib/library/store'
import type { LyricsStyle } from '@/lib/lyrics-style'
import {
  DEFAULT_LYRICS_STYLE,
  encodeSharedStyle,
  sameLyricsStyle,
} from '@/lib/lyrics-style'
import { useLikeSong, useSongStats } from '@/lib/song-stats'
import { cn } from '@/utils/cn'

import { LyricsThemePicker } from './lyrics-theme-picker'
import { LyricsVersionsMenu } from './lyrics-versions-menu'
import {
  RailButton,
  RailInline,
  RailTooltip,
  RailTooltipsOff,
} from './rail-button'
import { useReportIssue } from './report-issue'

// The style panel peeks open while the pointer rests on its button, and closes once the pointer has been off
// button and panel this long; a click pins it. The only hover-to-open surface left: it previews, and menus
// open on a click
const PEEK_OPEN_MS = 100
const PEEK_CLOSE_MS = 500

// A panel closed while the pointer is on the button or panel (a pick, a click elsewhere) stays closed until
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
      }, PEEK_OPEN_MS)
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
    }, PEEK_CLOSE_MS)
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

// One of the song's own actions (bookmark, playlist, share, read), drawn as a rail button or a menu item
interface SongAction {
  label: string
  icon: ReactNode
  disabled: boolean
  handleSelect: () => void
  // Left out of the watch page's row
  stageOnly?: boolean
  // A toggle's state, for its button's pressed look and aria-pressed
  pressed?: boolean
}

// Like: a toggle, one per account; the thumb fills while it is on. Likes are for accounts, as reports are: a
// guest's press signs in instead
const useLikeAction = (videoId: string): SongAction => {
  const guest = useAccess().kind === 'guest'
  const liked = useSongStats(videoId).data?.liked === true
  const { mutate: like } = useLikeSong(videoId)
  if (guest) {
    return {
      disabled: videoId === '',
      handleSelect: () => {
        void signInWithGoogle()
      },
      icon: <ThumbsUpIcon className='size-5 shrink-0' />,
      label: 'Sign In to Like',
    }
  }
  return {
    disabled: videoId === '',
    handleSelect: () => {
      like(!liked)
    },
    icon: (
      <ThumbsUpIcon
        className={cn('size-5 shrink-0', liked && 'fill-current')}
      />
    ),
    label: 'Like',
    pressed: liked,
  }
}

// The song's actions. A chart song (Top 100 Japan, not yet in Synbox) can only be generated or shared: nothing
// else is kept for it
const useSongActions = (
  videoId: string,
  share: SongAction,
  libraryActions: SongAction[]
): { actions: SongAction[]; chart: boolean } => {
  const chart = useAtomValue(chartSongAtom)?.videoId === videoId
  const title = useAtomValue(currentVideoAtom)?.title
  const phase = useGenerationPhase(videoId)
  const requestInstead = useRequestInsteadOfGenerating()
  const openRequestInvite = useOpenRequestInvite()
  if (!chart) {
    return { actions: libraryActions, chart }
  }
  // Out of today's songs on the default limit: the account can ask for more instead
  if (requestInstead && phase === null) {
    const request: SongAction = {
      disabled: false,
      handleSelect: openRequestInvite,
      icon: <TicketIcon className='size-5 shrink-0' />,
      label: 'Request Invite',
      stageOnly: true,
    }
    return { actions: [request, share], chart }
  }
  const generate: SongAction = {
    disabled: phase !== null,
    handleSelect: () => {
      startGenerating(videoId, title)
    },
    icon:
      phase === null ? (
        <SparklesIcon className='size-5 shrink-0' />
      ) : (
        <LoaderCircleIcon className='size-5 shrink-0 motion-safe:animate-spin' />
      ),
    label: GENERATE_LABELS[phase ?? 'idle'],
    // The watch page offers it in the lyrics panel, as a labelled button
    stageOnly: true,
  }
  return { actions: [generate, share], chart }
}

const BookmarkGlyph = ({ bookmarked }: { bookmarked: boolean }) =>
  bookmarked ? (
    <BookmarkCheckIcon className='size-5 shrink-0 fill-current [&>path:last-child]:stroke-black' />
  ) : (
    <BookmarkIcon className='size-5 shrink-0 -scale-x-100' />
  )

// On a phone on its side the rail is a column beside a video only ~390px tall, and upright a row across a screen
// ~400px wide: the lyrics' buttons fill either, so the song's own actions wait behind More
const SongActionsMenu = ({
  actions,
  hidden,
}: {
  actions: SongAction[]
  hidden: boolean
}) => {
  const [open, setOpen] = useState(false)
  // Upright the rail lies along the bottom, so the menu opens up from it
  const portrait = usePortrait()
  if (hidden) {
    return null
  }
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <RailButton
          label='More Actions'
          className={cn(
            'hidden portrait:grid short:grid',
            open && 'bg-white/10'
          )}>
          <EllipsisIcon className='size-5 shrink-0' />
        </RailButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={portrait ? 'top' : 'right'}
        align='end'
        sideOffset={8}
        collisionPadding={8}>
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.label}
            disabled={action.disabled}
            onSelect={action.handleSelect}>
            {/* As the other menus space their icons */}
            <span className='mr-2 flex'>{action.icon}</span>
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Inline (the watch page), the lyrics toggles and the song's actions are two groups that wrap whole, so a
// narrow screen gets a row of each and never one button alone on a second row
// On a phone each group is a row of equal cells across the whole width, every button filling its cell, so no row
// leaves a third of the screen empty
const groupClass = (inline: boolean) =>
  inline
    ? 'flex items-center gap-2 watch-narrow:grid watch-narrow:grid-flow-col watch-narrow:auto-cols-fr'
    : 'contents'

// The song's actions as buttons, but on a phone's floating rail (on its side or upright) behind More instead. A
// chart song has no lyrics to show or style: its rail is its two actions, Generate Lyrics first, never behind More
const actionsClass = (inline: boolean, chart: boolean) =>
  chart
    ? groupClass(inline)
    : cn(groupClass(inline), 'short:hidden', !inline && 'portrait:hidden')
const lyricsGroupClass = (inline: boolean, chart: boolean) =>
  chart ? 'hidden' : groupClass(inline)
const dividerClass = (chart: boolean) =>
  chart
    ? 'hidden'
    : 'my-0.5 h-px w-6 shrink-0 bg-white/15 portrait:my-0 portrait:h-6 portrait:w-px'

const railClass = (inline: boolean, interactive: boolean, open: boolean) =>
  inline
    ? 'flex w-fit max-w-full flex-wrap items-center gap-x-5 gap-y-2 watch-narrow:w-full watch-narrow:flex-col watch-narrow:items-stretch'
    : cn(
        // Its corners are the buttons' 8px radius plus the 4px padding around them, in every layout
        'flex flex-col items-center gap-1 rounded-r-xl bg-black/55 p-1 shadow-rail backdrop-blur-md transition-translate-fade duration-300 ease-out',
        'portrait:no-scrollbar portrait:max-w-[calc(100vw-0.5rem)] portrait:flex-row portrait:gap-1 portrait:overflow-x-auto portrait:rounded-xl',
        interactive && 'pointer-events-auto',
        // Past the notch inset too, or a phone on its side shows the rail's edge beside it
        open
          ? 'translate-x-0'
          : '-translate-x-[calc(100%+var(--safe-left))] motion-reduce:translate-x-0 motion-reduce:opacity-0 portrait:translate-x-0 portrait:opacity-0'
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

  // Published so that in portrait, where the rail sits on the control bar, the notices and the lyrics stay
  // above it
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
  const [saving, setSaving] = useState(false)
  const report = useReportIssue(videoId)
  const likeAction = useLikeAction(videoId)
  const saveButton = useRef<HTMLButtonElement>(null)
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
            description: 'Press Share again',
            title: "Couldn't Share",
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
      // The link itself, to select and copy by hand (the installed app has no address bar)
      toast({
        description: <span className='select-all'>{url.href}</span>,
        title: "Couldn't Copy the Link",
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

  const shareAction: SongAction = {
    disabled: false,
    handleSelect: () => {
      void handleShare()
    },
    icon: <PlatformShareIcon className='size-5 shrink-0' />,
    label: shareLabel,
  }
  const { actions: songActions, chart } = useSongActions(videoId, shareAction, [
    likeAction,
    {
      disabled: !currentVideo,
      handleSelect: handleBookmark,
      icon: <BookmarkGlyph bookmarked={bookmarked} />,
      label: bookmarkLabel,
    },
    {
      disabled: !currentVideo,
      handleSelect: () => {
        setSaving(true)
      },
      icon: <ListPlusIcon className='size-5 shrink-0' />,
      label: 'Save to Playlist',
    },
    shareAction,
    // The song's lyrics as a page to read or play along without the video. The watch page has them right
    // under the video already
    {
      disabled: videoId === '',
      handleSelect: () => {
        void navigate(`/lyrics/${videoId}`)
      },
      icon: <BookOpenTextIcon className='size-5 shrink-0' />,
      label: 'Read Lyrics',
      stageOnly: true,
    },
    {
      disabled: videoId === '',
      handleSelect: report.open,
      icon: <FlagIcon className='size-5 shrink-0' />,
      label: report.label,
    },
  ])
  const actions = songActions.filter(
    (action) => !(inline && action.stageOnly === true)
  )

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
              <div className={lyricsGroupClass(inline, chart)}>
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
              </div>

              {!inline && <div className={dividerClass(chart)} />}

              <div className={actionsClass(inline, chart)}>
                {actions.map((action) => (
                  <RailTooltip key={action.label} label={action.label}>
                    <RailButton
                      ref={
                        action.label === 'Save to Playlist'
                          ? saveButton
                          : undefined
                      }
                      label={action.label}
                      // Lit while on; off, an action looks like the others, not like a dimmed lyrics toggle
                      pressed={action.pressed === true ? true : undefined}
                      aria-pressed={action.pressed}
                      disabled={action.disabled}
                      onClick={action.handleSelect}>
                      {action.icon}
                    </RailButton>
                  </RailTooltip>
                ))}
              </div>
              {!inline && <SongActionsMenu actions={actions} hidden={chart} />}
            </nav>
          </div>
        </RailTooltipsOff>
      </RailInline>
      {currentVideo && (
        <SaveToPlaylist
          song={currentVideo}
          open={saving}
          onOpenChange={setSaving}
          returnFocusRef={saveButton}
        />
      )}
      {report.dialog}
    </TooltipProvider>
  )
}

export default PlayerRail
