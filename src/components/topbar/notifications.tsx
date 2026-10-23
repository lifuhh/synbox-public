import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'

import GenerationPanel from '@/components/generation/generation-panel'
import {
  BellGlyph,
  CountBadge,
  ProgressRing,
} from '@/components/generation/progress-ring'
import { RingToBell } from '@/components/generation/ring-to-bell'
import { usePresentation } from '@/components/generation/use-presentation'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useHoverMenu } from '@/hooks/use-hover-menu'
import type { Job } from '@/lib/generation/store'
import {
  activeCount,
  focusedJob,
  leadJob,
  markGenerationsSeen,
  setGenerationExpanded,
  unseenCount,
  useGeneration,
} from '@/lib/generation/store'
import { cn } from '@/utils/cn'

// The ring turning into the bell after the last song in progress ends
interface Farewell {
  from: number
  done: boolean
  // Unseen songs when it began; fixed, so opening the panel midway doesn't restart it
  count: number
}

const prefersReducedMotion = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches

// Played when the store goes from songs in progress to none, never on a page that loads with none. Reduced
// motion goes straight to the bell
const useFarewell = (
  going: number,
  followed: Job | null,
  overall: number | undefined,
  unseen: number
) => {
  const [wasGoing, setWasGoing] = useState(going)
  const [farewell, setFarewell] = useState<Farewell | null>(null)
  if (going !== wasGoing) {
    setWasGoing(going)
    if (going > 0) {
      setFarewell(null)
    } else if (!prefersReducedMotion()) {
      setFarewell({
        count: unseen,
        done: followed?.status.kind === 'complete',
        from: overall ?? 0,
      })
    }
  }
  return [farewell, setFarewell] as const
}

// The button can be hidden with the whole top bar: the reader covers it, and the phone's full-screen player
// and Lock Landscape take the bar away
const isShown = (element: HTMLElement | null): element is HTMLElement =>
  element !== null &&
  (element.checkVisibility?.({ visibilityProperty: true }) ??
    element.getClientRects().length > 0)

// Input that scrolls the page. A drag or wheel that starts outside the panel means the listener carried on with the
// page: the panel steps aside into its button rather than stay over the page as the top bar slides away. Not
// `scroll` events, which the app also causes on its own (the player's lyrics follow the song)
const SCROLL_INPUT = ['wheel', 'touchmove'] as const

// Where the button's centre sits in the panel's own box, as a transform origin: the panel opens from it and
// shrinks back into it. Unset (the corner Radix picks) while the button isn't on screen
const aimAtButton = (panel: HTMLElement | null, ring: HTMLElement | null) => {
  if (panel === null) {
    return
  }
  if (!isShown(ring)) {
    panel.style.removeProperty('--trigger-origin')
    return
  }
  const box = panel.getBoundingClientRect()
  const target = ring.getBoundingClientRect()
  const x = target.left + target.width / 2 - box.left
  const y = target.top + target.height / 2 - box.top
  panel.style.setProperty('--trigger-origin', `${x}px ${y}px`)
}

const nameOf = (
  going: number,
  view: { overall: number; reconnecting: boolean } | null,
  unseen: number
) => {
  if (view !== null) {
    const percent = Math.floor(view.overall * 100)
    return `Notifications: ${going} generating, ${percent}%${view.reconnecting ? ', reconnecting' : ''}`
  }
  return unseen > 0 ? `Notifications: ${unseen} new` : 'Notifications'
}

// The top bar's one place for lyrics generations. While songs generate it is a ring with the head of the
// line's progress and how many are going; otherwise a bell, counting finished songs not yet looked at. It
// opens the panel with every song, the picked one's steps, and each song's actions
const Notifications = () => {
  const generation = useGeneration()
  const { jobs, expanded } = generation
  // oxlint-disable-next-line react/purity -- ties are broken on progress now; the ring's ticker re-renders this
  const lead = leadJob(jobs, Date.now())
  // The last song the ring followed, so the ring can close on it after it ends
  const [followedId, setFollowedId] = useState<string | null>(null)
  if (lead !== null && lead.id !== followedId) {
    setFollowedId(lead.id)
  }
  const followed = lead ?? jobs.find((job) => job.id === followedId) ?? null
  const view = usePresentation(followed)
  const going = activeCount(generation)
  const unseen = unseenCount(generation)

  const [farewell, setFarewell] = useFarewell(
    going,
    followed,
    view?.overall,
    unseen
  )
  const ring = going > 0 && view !== null

  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const menu = useHoverMenu(expanded, setGenerationExpanded)
  // A song started while the bar is hidden doesn't open a panel nobody can see or close from its button
  useLayoutEffect(() => {
    if (expanded && !isShown(trigger.current)) {
      setGenerationExpanded(false)
    }
  }, [expanded])
  // A new page closes the panel: a Play in it, a tab, the back button
  const { pathname } = useLocation()
  const shownOn = useRef(pathname)
  useEffect(() => {
    if (shownOn.current !== pathname) {
      shownOn.current = pathname
      setGenerationExpanded(false)
    }
  }, [pathname])
  useEffect(() => {
    const away = (event: Event) => {
      const { target } = event
      if (
        target instanceof Node &&
        (panel.current?.contains(target) === true ||
          trigger.current?.contains(target) === true)
      ) {
        return
      }
      setGenerationExpanded(false)
    }
    const listen = () => {
      for (const type of SCROLL_INPUT) {
        document.addEventListener(type, away, { capture: true, passive: true })
      }
      return () => {
        for (const type of SCROLL_INPUT) {
          document.removeEventListener(type, away, { capture: true })
        }
      }
    }
    return expanded ? listen() : undefined
  }, [expanded])
  // Measured as it starts closing, before the first frame of the exit, wherever the panel and button are then
  useLayoutEffect(() => {
    if (!expanded) {
      aimAtButton(panel.current, trigger.current)
    }
  }, [expanded])
  // Whatever finished is seen once the panel is open on it, including songs that finish while it is open
  useEffect(() => {
    if (expanded && unseen > 0 && isShown(trigger.current)) {
      markGenerationsSeen()
    }
  }, [expanded, unseen])

  // A song started elsewhere opens the panel without taking focus from where the listener is; a press on
  // this button moves focus in, as any menu does. Focus comes back here only from inside the panel, with
  // the keyboard ring only after a key press: iPhone WebKit draws it after a tap otherwise
  const pressed = useRef(false)
  const byKeyboard = useRef(false)
  const focusInside = useRef(false)

  // The panel keeps showing its last song while it closes after that song left the list
  const shown = focusedJob(generation) ?? jobs.at(-1) ?? null
  const [kept, setKept] = useState<Job | null>(shown)
  if (shown !== null && shown !== kept) {
    setKept(shown)
  }
  const body = shown ?? (expanded ? null : kept)

  const name = nameOf(going, ring ? view : null, unseen)

  const icon = () => {
    if (ring) {
      return <ProgressRing overall={view.overall} count={going} />
    }
    if (farewell !== null) {
      return (
        <RingToBell
          from={farewell.from}
          done={farewell.done}
          count={farewell.count}
          onDone={() => {
            setFarewell(null)
          }}
        />
      )
    }
    return (
      <>
        <BellGlyph />
        {unseen > 0 && <CountBadge count={unseen} />}
      </>
    )
  }

  return (
    <Popover open={expanded} onOpenChange={setGenerationExpanded} modal={false}>
      <PopoverTrigger asChild>
        <Button
          ref={trigger}
          variant='toolbar'
          size='icon'
          aria-label={name}
          // The top bar keeps it in view while the player's other controls fade, while songs generate
          data-notifications
          data-busy={ring || farewell !== null || undefined}
          className={cn(
            'relative',
            (ring || farewell !== null) && 'pointer-events-auto'
          )}
          {...menu.trigger}
          onClick={(event) => {
            pressed.current = !expanded
            byKeyboard.current = event.detail === 0
            menu.trigger.onClick(event)
          }}>
          {icon()}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        {...menu.content}
        ref={panel}
        align='end'
        sideOffset={10}
        collisionPadding={8}
        variant='floating-tucked'
        aria-label='Notifications'
        // Held on screen while open or closing: the top bar stays in (globals.css) so the button it closes into is there
        data-generation-panel
        // Radix starts the open animation once the panel is placed
        onAnimationStart={(event) => {
          if (event.target === event.currentTarget) {
            aimAtButton(panel.current, trigger.current)
          }
        }}
        onOpenAutoFocus={(event) => {
          // Onto the panel itself rather than its first button, which would show a focus ring after a
          // press; Tab goes on from there
          event.preventDefault()
          if (pressed.current) {
            panel.current?.focus({ preventScroll: true })
          } else {
            byKeyboard.current = false
          }
          pressed.current = false
        }}
        // Like the old panel, only a press outside closes it: focus moving elsewhere (a menu handing focus
        // back to its button as the song starts) leaves it open
        onFocusOutside={(event) => {
          event.preventDefault()
        }}
        onFocus={() => {
          focusInside.current = true
        }}
        onKeyDown={() => {
          byKeyboard.current = true
        }}
        onPointerDown={() => {
          byKeyboard.current = false
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            focusInside.current = false
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (focusInside.current) {
            trigger.current?.focus({
              focusVisible: byKeyboard.current,
              preventScroll: true,
            })
          }
          focusInside.current = false
        }}
        className='max-h-[min(38rem,calc(var(--radix-popover-content-available-height)-var(--safe-bottom)))] w-[min(25rem,calc(100vw-1rem-var(--safe-left)-var(--safe-right)))] overflow-x-hidden overflow-y-auto overscroll-contain'>
        {body === null ? (
          <p className='px-6 py-8 text-center text-sm text-muted-foreground'>
            No Notifications
          </p>
        ) : (
          <GenerationPanel job={body} jobs={jobs} />
        )}
      </PopoverContent>
    </Popover>
  )
}

export default Notifications
