import { CloudOffIcon, RefreshCwIcon, XIcon } from 'lucide-react'
import { useCallback } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

import { useOnline } from '@/lib/pwa'

// A tab or installed app left open for days still notices a new deploy
const UPDATE_CHECK_MS = 60 * 60 * 1000

const pill =
  'pointer-events-auto flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-popover/90 px-4 text-sm text-foreground shadow-lg backdrop-blur-md'

// Offline and update notices, stacked under the top bar. The stack's height is published as
// --notices-h so the toasts open below it rather than over it
const AppNotices = () => {
  const online = useOnline()
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_url, registration) => {
      if (registration) {
        setInterval(() => {
          void registration.update()
        }, UPDATE_CHECK_MS)
      }
    },
  })

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
      {!online && (
        <output className={pill}>
          <CloudOffIcon className='size-4 shrink-0 text-primary' />
          Offline. Songs and lyrics need a connection.
        </output>
      )}
      {needRefresh && (
        <output className={pill}>
          <RefreshCwIcon className='size-4 shrink-0 text-primary' />
          <span>A new version of Synbox is ready.</span>
          <button
            type='button'
            onClick={() => {
              void updateServiceWorker(true)
            }}
            className='-my-1 min-h-9 rounded-full bg-primary px-3 font-medium text-white transition-colors hover:bg-primary/85'>
            Reload
          </button>
          <button
            type='button'
            aria-label='Dismiss'
            onClick={() => {
              setNeedRefresh(false)
            }}
            className='-mr-2 grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground'>
            <XIcon className='size-4' />
          </button>
        </output>
      )}
    </div>
  )
}

export default AppNotices
