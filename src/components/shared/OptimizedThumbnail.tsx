import type { MouseEventHandler } from 'react'
import { useState } from 'react'

interface OptimizedThumbnailProps {
  src: string
  alt: string
  onClick?: MouseEventHandler<HTMLImageElement>
  className?: string
}

const OptimizedThumbnail = ({
  src,
  alt,
  onClick,
  className,
}: OptimizedThumbnailProps) => {
  const [isLoading, setIsLoading] = useState(true)

  return (
    <div className='relative aspect-video h-[50px] w-[80px] shrink-0 overflow-hidden rounded-xs'>
      {isLoading && (
        <div className='absolute inset-0 animate-pulse bg-gray-800' />
      )}
      <img
        src={src}
        alt={alt}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
          isLoading ? 'opacity-0' : 'opacity-100'
        } ${className ?? ''}`}
        onClick={onClick}
        onLoad={() => {
          setIsLoading(false)
        }}
        loading='lazy'
      />
    </div>
  )
}

export default OptimizedThumbnail
