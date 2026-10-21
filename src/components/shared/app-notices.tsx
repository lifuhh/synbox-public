import { CloudOffIcon, WifiIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMatch } from 'react-router'

import { useOnline } from '@/lib/pwa'

const pill =
  'pointer-events-auto flex h-8 items-center gap-1.5 rounded-full bg-popover/90 px-3 text-xs text-foreground shadow-lg backdrop-blur-md'

// How long the note about a connection change stays up
const NOTICE_MS = 2000

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
// over it. None over the lyrics reader: it works the same without a connection, and nothing should cover it
const AppNotices = () => {
  const notice = useConnectionNotice()
  const onReader = useMatch('/lyrics/:videoId') !== null
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

  return (
    <div
      ref={publishHeight}
      className='pointer-events-none fixed inset-x-0 top-(--topbar-h) z-100 flex flex-col items-center gap-2 px-4 empty:hidden [&:not(:empty)]:pt-2'>
      {!onReader && notice === 'offline' && (
        <output className={pill}>
          <CloudOffIcon className='size-3.5 shrink-0 text-primary-text' />
          Lost Connection
        </output>
      )}
      {!onReader && notice === 'online' && (
        <output className={pill}>
          <WifiIcon className='size-3.5 shrink-0 text-primary-text' />
          Reconnected
        </output>
      )}
    </div>
  )
}

export default AppNotices
