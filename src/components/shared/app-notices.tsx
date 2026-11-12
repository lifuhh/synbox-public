import {
  CircleCheckIcon,
  CloudOffIcon,
  MegaphoneIcon,
  WifiIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useMatch } from 'react-router'

import { appJustUpdated, useOnline } from '@/lib/pwa'
import { LATEST_ENTRY, useWhatsNew, whatsNewPath } from '@/lib/whats-new'
import { cn } from '@/utils/cn'

const pill =
  'pointer-events-auto flex h-8 items-center gap-1.5 rounded-full bg-glass px-3 text-xs text-foreground shadow-lg backdrop-blur-md'

// How long the note about a connection change stays up
const NOTICE_MS = 2000
// How long the note that opens What's New stays up: long enough to read it and reach for it. A pointer resting on it
// or focus inside holds it
const NEWS_MS = 8000

// The note on the first load of a new version. `news` links to What's New while its newest entry is unread by this
// listener (lib/whats-new › whatsNewUnread), so a release that added no entry says only `updated` to someone who read
// the last one, and someone back after a while hears of what they missed whatever the last release changed
type UpdatedNotice = 'news' | 'updated' | null

// Decided once, on the load: reading the entry while the note shows doesn't turn it into another note. Shown for
// NEWS_MS (held while `held`) or NOTICE_MS; null once pressed
const useUpdatedNotice = (held: boolean) => {
  const { unread } = useWhatsNew()
  const [notice, setNotice] = useState<UpdatedNotice>(() => {
    if (!appJustUpdated) {
      return null
    }
    return unread ? 'news' : 'updated'
  })
  useEffect(() => {
    const timer =
      notice !== null && !held
        ? setTimeout(
            () => {
              setNotice(null)
            },
            notice === 'news' ? NEWS_MS : NOTICE_MS
          )
        : undefined
    return () => {
      clearTimeout(timer)
    }
  }, [notice, held])
  return [notice, setNotice] as const
}

type ConnectionNotice = 'offline' | 'online' | null

// A note when the connection drops or comes back, that leaves on its own
const useConnectionNotice = () => {
  const online = useOnline()
  const [notice, setNotice] = useState<ConnectionNotice>(null)
  const last = useRef(online)
  useEffect(() => {
    const changed = last.current !== online
    last.current = online
    const kind = online ? 'online' : 'offline'
    if (changed) {
      setNotice(kind)
    }
    const timer = setTimeout(
      () => {
        if (changed) {
          setNotice(null)
        }
      },
      changed ? NOTICE_MS : 0
    )
    return () => {
      clearTimeout(timer)
    }
  }, [online])
  return notice
}

// Notes under the top bar. Its height is published as --notices-h so the toasts open below it rather than
// over it. None over the lyrics reader: it works the same without a connection, and nothing should cover it.
// The update note with news opens the newest What's New entry; its press area reaches 6px above and below the pill (44px)
const AppNotices = () => {
  const notice = useConnectionNotice()
  const [held, setHeld] = useState(false)
  const [updated, setUpdated] = useUpdatedNotice(held)
  const onReader = useMatch('/lyrics/:videoId') !== null
  const onWhatsNew = useMatch('/whats-new') !== null
  const publishHeight = useCallback((stack: HTMLDivElement) => {
    const root = document.documentElement
    const observer = new ResizeObserver(() => {
      root.style.setProperty('--notices-h', `${stack.offsetHeight}px`)
    })
    observer.observe(stack)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--notices-h')
    }
  }, [])

  const showUpdated = onReader || onWhatsNew ? null : updated
  const said = onReader
    ? []
    : [
        showUpdated === 'news' && 'Updated. See What’s New',
        showUpdated === 'updated' && 'Updated',
        notice === 'offline' && 'Lost Connection',
        notice === 'online' && 'Reconnected',
      ].filter((text) => text !== false)

  return (
    <>
      {/* Mounted empty, so a screen reader hears each notice as its text arrives; the pills are what is seen */}
      <p className='sr-only' aria-live='polite'>
        {said.join('. ')}
      </p>
      <div
        ref={publishHeight}
        className='pointer-events-none fixed inset-x-0 top-(--topbar-h) z-100 flex flex-col items-center gap-2 px-4 empty:hidden [&:not(:empty)]:pt-2'>
        {showUpdated === 'news' && (
          <Link
            to={whatsNewPath(LATEST_ENTRY)}
            data-bench='updated-notice'
            onClick={() => {
              setUpdated(null)
            }}
            onPointerEnter={() => {
              setHeld(true)
            }}
            onPointerLeave={() => {
              setHeld(false)
            }}
            onFocus={() => {
              setHeld(true)
            }}
            onBlur={() => {
              setHeld(false)
            }}
            className={cn(
              pill,
              "relative bg-primary-subtle transition-colors after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] hover:bg-primary-subtle/80"
            )}>
            <MegaphoneIcon
              aria-hidden
              className='size-3.5 shrink-0 text-primary-text'
            />
            Updated · See What’s New
          </Link>
        )}
        {showUpdated === 'updated' && (
          <div aria-hidden data-bench='updated-notice' className={pill}>
            <CircleCheckIcon className='size-3.5 shrink-0 text-primary-text' />
            Updated
          </div>
        )}
        {!onReader && notice === 'offline' && (
          <div aria-hidden className={pill}>
            <CloudOffIcon className='size-3.5 shrink-0 text-primary-text' />
            Lost Connection
          </div>
        )}
        {!onReader && notice === 'online' && (
          <div aria-hidden className={pill}>
            <WifiIcon className='size-3.5 shrink-0 text-primary-text' />
            Reconnected
          </div>
        )}
      </div>
    </>
  )
}

export default AppNotices
