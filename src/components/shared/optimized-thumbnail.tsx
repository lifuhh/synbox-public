import { useState } from 'react'

interface OptimizedThumbnailProps {
  src: string
  alt: string
  className?: string
  // Laid over the picture, as the karaoke corner
  children?: React.ReactNode
}

const OptimizedThumbnail = ({
  src,
  alt,
  className,
  children,
}: OptimizedThumbnailProps) => {
  const [isLoading, setIsLoading] = useState(true)

  return (
    <div className='relative aspect-video h-[50px] w-[80px] shrink-0 overflow-hidden rounded-xs'>
      {isLoading && (
        <div className='absolute inset-0 animate-pulse bg-thumbnail-placeholder' />
      )}
      <img
        src={src}
        alt={alt}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
          isLoading ? 'opacity-0' : 'opacity-100'
        } ${className ?? ''}`}
        onLoad={() => {
          setIsLoading(false)
        }}
        loading='lazy'
      />
      {children}
    </div>
  )
}

export default OptimizedThumbnail
