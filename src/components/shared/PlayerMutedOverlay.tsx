import { CheckIcon, LoaderIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

// Material "PlayCircleFilled" path (Apache-2.0): lucide's CirclePlay paints its circle over the triangle
const PlayCircleFilledIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox='0 0 24 24'
    fill='currentColor'
    aria-hidden='true'
    focusable='false'
    className={className}>
    <path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z' />
  </svg>
)

const PlayerMutedOverlay = ({
  handleInitMutedPlay,
}: {
  handleInitMutedPlay: () => void
}) => {
  const [isInitializing, setIsInitializing] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsInitializing(false)
    }, 750)

    return () => {
      clearTimeout(timer)
    }
  }, [])

  return (
    <div
      onClick={isInitializing ? undefined : handleInitMutedPlay}
      className={`flex h-full w-full ${
        isInitializing ? '' : 'cursor-pointer'
      } flex-col items-center justify-center bg-black/30 backdrop-blur-xs`}>
      {isInitializing ? (
        <div className='flex items-center gap-2 rounded-lg p-4'>
          <LoaderIcon className='h-10 w-10 animate-spin text-white' />
          <p className='text-xl font-medium text-white [text-shadow:0_1px_1px_rgba(0,0,0,0.8)]'>
            Initializing...
          </p>
        </div>
      ) : (
        <div className='flex flex-col items-center justify-center'>
          <div className='rounded-xl p-8'>
            <PlayCircleFilledIcon className='inline-block size-[104px] text-white opacity-95 transition-transform duration-200 hover:scale-105 hover:opacity-100' />
            <div className='mx-auto mt-4 flex items-center justify-center gap-2'>
              <CheckIcon className='h-8 w-8 animate-pulse text-white' />
              <p className='text-xl font-medium text-white [text-shadow:0_1px_1px_rgba(0,0,0,0.8)]'>
                Ready!
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PlayerMutedOverlay
