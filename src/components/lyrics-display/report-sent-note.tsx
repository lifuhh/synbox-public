import { useSetAtom } from 'jotai'
import { CheckIcon, FlagIcon } from 'lucide-react'
import type { RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { playerChromeHeldAtom } from '@/context/atoms'
import { usePortrait } from '@/hooks/use-media-query'
import { MENU_GAP } from '@/lib/menu-offset'
import { cn } from '@/utils/cn'

import { useReportIssue } from './report-issue'

// How long Report Sent stays beside its button
export const REPORT_SENT_MS = 3000
// Kept off the screen's edge by this much, past the safe areas
const EDGE_GAP = 8

type Insets = Record<'top' | 'right' | 'bottom' | 'left', number>
const NO_INSETS: Insets = { bottom: 0, left: 0, right: 0, top: 0 }

// A box sized by two of the safe areas, as the page draws them (Lock Landscape turns them with the page). Its layout
// size, not its screen box, which the turned page rotates
const insetBox = (width: string, height: string) => {
  const probe = document.createElement('div')
  probe.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;width:${width};height:${height}`
  document.body.append(probe)
  const size = { height: probe.offsetHeight, width: probe.offsetWidth }
  probe.remove()
  return size
}

const safeInsets = (): Insets => {
  const start = insetBox('var(--safe-left)', 'var(--safe-top)')
  const end = insetBox('var(--safe-right)', 'var(--safe-bottom)')
  return {
    bottom: end.height + EDGE_GAP,
    left: start.width + EDGE_GAP,
    right: end.width + EDGE_GAP,
    top: start.height + EDGE_GAP,
  }
}

// The first of the buttons that is drawn: Report itself, or More where Report waits behind it (a phone's rail)
const drawnOf = (buttons: (HTMLElement | null)[]) =>
  buttons.find(
    (button): button is HTMLElement =>
      button !== null && button.getClientRects().length > 0
  ) ?? null

// "Report Sent", on a light pill beside the button that sent it: above a row of buttons, beside a column, turned
// to the other side when there is no room. It follows the button every frame (the rail slides in as it shows),
// draws over the lyrics and takes no presses. Screen readers hear it from the status line beside it, so the pill
// itself is hidden from them
const ReportSentNote = ({
  anchorRef,
  open,
  side,
  padding,
  onDone,
}: {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  side: 'top' | 'right'
  padding: Insets
  onDone: () => void
}) => {
  useEffect(() => {
    const timer = open ? setTimeout(onDone, REPORT_SENT_MS) : undefined
    return () => {
      clearTimeout(timer)
    }
  }, [open, onDone])
  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            onDone()
          }
        }}>
        <PopoverAnchor virtualRef={anchorRef} />
        <PopoverContent
          data-bench='report-sent'
          aria-hidden
          variant='callout'
          side={side}
          sideOffset={MENU_GAP}
          collisionPadding={padding}
          updatePositionStrategy='always'
          // Nothing in it to focus: focus stays where the dialog returned it, and moving it elsewhere keeps the pill
          onOpenAutoFocus={(event) => {
            event.preventDefault()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
          }}
          onFocusOutside={(event) => {
            event.preventDefault()
          }}
          className='pointer-events-none z-999'>
          <CheckIcon className='size-4 shrink-0' strokeWidth={2.5} />
          Report Sent
        </PopoverContent>
      </Popover>
      {/* Rendered empty first, so the words are announced when they arrive */}
      <output className='sr-only'>{open ? 'Report Sent' : ''}</output>
    </>
  )
}

// Report Issue on the player's rail: its flag fills while the account's report on the song is open, and a sent
// report says so beside the button. On the stage the floating UI stays up while it does, so the button is there
export const useRailReport = (videoId: string, inline: boolean) => {
  const portrait = usePortrait()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const anchorRef = useRef<HTMLElement>(null)
  const [padding, setPadding] = useState(NO_INSETS)
  const setHeld = useSetAtom(playerChromeHeldAtom)
  const report = useReportIssue(videoId, () => {
    anchorRef.current = drawnOf([buttonRef.current, moreRef.current])
    setPadding(safeInsets())
    if (!inline) {
      setHeld(true)
    }
  })
  const { endSent } = report
  const done = useCallback(() => {
    endSent()
    setHeld(false)
  }, [endSent, setHeld])
  useEffect(
    () => () => {
      setHeld(false)
    },
    [setHeld]
  )
  return {
    buttonRef,
    dialog: report.dialog,
    // The flag fills and empties as a fade
    icon: (
      <FlagIcon
        className={cn(
          'size-5 shrink-0 transition-fill duration-300 ease-out',
          report.reported ? 'fill-current' : 'fill-transparent'
        )}
      />
    ),
    label: report.label,
    moreRef,
    note: (
      <ReportSentNote
        anchorRef={anchorRef}
        open={report.sent}
        side={inline || portrait ? 'top' : 'right'}
        padding={padding}
        onDone={done}
      />
    ),
    open: report.open,
    sent: report.sent,
  }
}
