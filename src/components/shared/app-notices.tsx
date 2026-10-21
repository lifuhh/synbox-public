import { ChevronRightIcon, CloudOffIcon } from 'lucide-react'
import { useCallback } from 'react'
import { Link, useMatch } from 'react-router'

import { useOnline } from '@/lib/pwa'

const pill =
  'pointer-events-auto flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-popover/90 px-4 text-sm text-foreground shadow-lg backdrop-blur-md'

// The offline notice, under the top bar. Its height is published as
// --notices-h so the toasts open below it rather than over it
const AppNotices = () => {
  const online = useOnline()
  // The offline pages are the place to be without a connection
  const onOfflinePage = useMatch('/offline/*') !== null
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
      {!online && !onOfflinePage && (
        <output>
          <Link to='/offline' className={pill}>
            <CloudOffIcon className='size-4 shrink-0 text-primary' />
            Offline. Read your saved lyrics
            <ChevronRightIcon className='-mr-1 size-4 shrink-0' />
          </Link>
        </output>
      )}
    </div>
  )
}

export default AppNotices
