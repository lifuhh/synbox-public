import { useEffect, useState } from 'react'

import { useMediaQuery } from './useMediaQuery'

// After a tap reveals the player's floating UI, the browser's click for that same tap lands on whatever
// appeared under the finger. Touch screens keep the UI inert this long after it opens
const ARM_MS = 350

export const useArmed = (open: boolean) => {
  const touch = useMediaQuery('(pointer: coarse)')
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const timer =
      open && touch
        ? setTimeout(() => {
            setArmed(true)
          }, ARM_MS)
        : undefined
    return () => {
      clearTimeout(timer)
      setArmed(false)
    }
  }, [open, touch])
  return open && (!touch || armed)
}
