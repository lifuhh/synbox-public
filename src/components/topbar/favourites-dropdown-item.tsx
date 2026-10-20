import { useAtom } from 'jotai'
import { X } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { removeFavoriteAtom } from '@/context/atoms'
import { useOverflow } from '@/hooks/use-overflow'

import OptimizedThumbnail from '../shared/optimized-thumbnail'
import { Button } from '../ui/button'

interface FavouritesDropdownItemProps {
  videoId: string
  title: string
  author: string
  thumbnailUrl: string
}

const FavouritesDropdownItem: React.FC<FavouritesDropdownItemProps> = ({
  videoId,
  title,
  author,
  thumbnailUrl,
}) => {
  const navigate = useNavigate()
  const textRef = useRef<HTMLSpanElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [, removeFavorite] = useAtom(removeFavoriteAtom)

  useEffect(() => {
    const checkOverflow = () => {
      if (textRef.current && containerRef.current) {
        setIsOverflowing(
          textRef.current.scrollWidth > containerRef.current.clientWidth
        )
      }
    }

    checkOverflow()
    window.addEventListener('resize', checkOverflow)

    return () => {
      window.removeEventListener('resize', checkOverflow)
    }
  }, [title])

  useOverflow(textRef, containerRef, 'marquee')

  const handleClick = () => {
    void navigate(`/v/${videoId}`)
  }

  const handleRemove = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    removeFavorite(videoId)
  }

  return (
    <DropdownMenuItem variant='media'>
      <div className='flex h-full w-full playlist-item items-center space-x-2'>
        <OptimizedThumbnail
          src={thumbnailUrl}
          alt={title}
          onClick={handleClick}
          className='cursor-pointer'
        />
        <div className='min-w-0 grow'>
          <div
            ref={containerRef}
            className={`font-bold tracking-wide text-song-title ${
              isOverflowing ? 'marquee' : 'overflow-hidden'
            }`}
            onClick={handleClick}>
            <span
              ref={textRef}
              className='inline-block cursor-pointer whitespace-nowrap'>
              {title}
            </span>
          </div>
          <div className='truncate text-sm text-song-meta'>{author}</div>
        </div>
        <Button
          onClick={handleRemove}
          variant='ghost-primary'
          size='narrow'
          className='ml-2 cursor-pointer'>
          <X className='h-4 w-4' />
        </Button>
      </div>
    </DropdownMenuItem>
  )
}

export default FavouritesDropdownItem
