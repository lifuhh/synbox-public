import { useState } from 'react'
import type { ReactNode } from 'react'

import { cn } from '@/utils/cn'

// Pictures this page has already shown, so a remounted avatar shows them at once instead of fading in again
const loadedAvatars = new Set<string>()

// The fallback stays until the picture has fully loaded, then the two crossfade; signing out fades back. A
// picture that fails to load (offline, or Google refusing a repeated request) keeps the fallback, never the
// browser's broken-image icon. Requested with CORS, which Google's picture host allows, so the service worker
// can tell a picture from an error and keep only pictures (vite.config.ts › avatars)
export const UserAvatar = ({
  src,
  fallback,
  className = 'size-full',
}: {
  src: string | null
  fallback: ReactNode
  // The box the picture fills: its container by default; the top bar's is the size of the icons beside it
  className?: string
}) => {
  const [lastSrc, setLastSrc] = useState(src)
  const [loaded, setLoaded] = useState(src !== null && loadedAvatars.has(src))
  const [failed, setFailed] = useState(false)
  if (src !== null && src !== lastSrc) {
    setLastSrc(src)
    setLoaded(loadedAvatars.has(src))
    setFailed(false)
  }
  const shown = src !== null && loaded && !failed

  return (
    <span className={cn('relative grid place-items-center', className)}>
      <span
        className={cn(
          'grid place-items-center transition-opacity duration-300 motion-reduce:transition-none',
          shown && 'opacity-0'
        )}>
        {fallback}
      </span>
      {lastSrc !== null && !failed && (
        <img
          key={lastSrc}
          src={lastSrc}
          alt=''
          crossOrigin='anonymous'
          referrerPolicy='no-referrer'
          onLoad={() => {
            loadedAvatars.add(lastSrc)
            setLoaded(true)
          }}
          onError={() => {
            loadedAvatars.delete(lastSrc)
            setFailed(true)
          }}
          className={cn(
            'absolute inset-0 size-full rounded-full object-cover transition-opacity duration-300 motion-reduce:transition-none',
            !shown && 'opacity-0'
          )}
        />
      )}
    </span>
  )
}
