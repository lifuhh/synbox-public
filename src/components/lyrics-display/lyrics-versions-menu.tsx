import { WandSparklesIcon } from 'lucide-react'
import { use, useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { Link } from 'react-router'

import { startFromButton } from '@/components/generation/start-generation'
import { AdminCornerMark } from '@/components/shared/admin-mark'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePortrait } from '@/hooks/use-media-query'
import { useGetLyricsVersions } from '@/lib/react-query/queries-and-mutations'
import { cn } from '@/utils/cn'

import { RailButton, RailInline, RailTooltip } from './rail-button'

// As the style button's peek: a short rest on the button opens the menu, and a grace after leaving lets the
// pointer cross the gap to it
const OPEN_DELAY_MS = 150
const CLOSE_DELAY_MS = 300

const mouse = (event: PointerEvent) => event.pointerType === 'mouse'

// With a mouse the menu opens while the pointer rests on the button or the menu, and closes once it has left
// both. A click opens it the same way and never holds it open. Touch and the keyboard open and close it as a
// plain menu
const useHoverMenu = () => {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(
    () => () => {
      clearTimeout(timerRef.current)
    },
    []
  )
  const later = (next: boolean, ms: number) => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setOpen(next)
    }, ms)
  }
  return {
    handleOpenChange: (next: boolean) => {
      clearTimeout(timerRef.current)
      setOpen(next)
    },
    // A press on the button lands outside the menu, which would close it
    handlePointerDownOutside: (event: Event) => {
      if (
        event.target instanceof Node &&
        triggerRef.current?.contains(event.target) === true
      ) {
        event.preventDefault()
      }
    },
    hover: {
      onPointerEnter: (event: PointerEvent) => {
        if (mouse(event)) {
          later(true, OPEN_DELAY_MS)
        }
      },
      onPointerLeave: (event: PointerEvent) => {
        if (mouse(event)) {
          later(false, CLOSE_DELAY_MS)
        }
      },
    },
    open,
    // Radix toggles the menu on the press; a mouse press only opens it
    trigger: {
      onPointerDown: (event: PointerEvent) => {
        if (mouse(event)) {
          event.preventDefault()
          clearTimeout(timerRef.current)
          setOpen(true)
        }
      },
      ref: triggerRef,
    },
  }
}

// Admins only (the rail shows it to no one else; the gear says so): a regeneration is saved as a new version
// and becomes the default; the versions page rolls back
export const LyricsVersionsMenu = ({ videoId }: { videoId: string }) => {
  const menu = useHoverMenu()
  const portrait = usePortrait()
  const inline = use(RailInline)
  const below = portrait || inline
  const { data } = useGetLyricsVersions(videoId)
  const count = data?.versions.length ?? 0

  return (
    <DropdownMenu
      modal={false}
      open={menu.open}
      onOpenChange={menu.handleOpenChange}>
      <RailTooltip label='Lyrics Versions' hidden={menu.open}>
        <DropdownMenuTrigger asChild>
          <RailButton
            label='Lyrics Versions'
            {...menu.hover}
            {...menu.trigger}
            className={cn('relative', menu.open && 'bg-white/10')}>
            <WandSparklesIcon className='size-5 shrink-0' />
            <AdminCornerMark />
          </RailButton>
        </DropdownMenuTrigger>
      </RailTooltip>
      <DropdownMenuContent
        {...menu.hover}
        onPointerDownOutside={menu.handlePointerDownOutside}
        side={below ? 'bottom' : 'right'}
        align={below ? 'center' : 'start'}
        sideOffset={8}
        collisionPadding={8}>
        <DropdownMenuItem
          onSelect={() => {
            void startFromButton({ mode: 'regenerate', videoId })
          }}>
          Regenerate Lyrics
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void startFromButton({
              mode: 'regenerate',
              skipUploaderLyrics: true,
              videoId,
            })
          }}>
          Regenerate Without Uploader Lyrics
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={`/v/${videoId}/versions`}>
            {count > 0 ? `All Versions (${count})` : 'All Versions'}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
