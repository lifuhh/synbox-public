import { useAtom } from 'jotai'
import { X } from 'lucide-react'
import React, { useRef } from 'react'
import { useNavigate } from 'react-router'

import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { removeFavoriteAtom } from '@/context/atoms'
import { useOverflow } from '@/hooks/use-overflow'

import { KaraokeMark } from '../shared/karaoke-badge'
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
  const [, removeFavorite] = useAtom(removeFavoriteAtom)

  const isOverflowing = useOverflow(textRef, containerRef)

  const handleClick = () => {
    void navigate(`/v/${videoId}`)
  }

  const handleRemove = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    removeFavorite(videoId)
  }

  return (
    <DropdownMenuItem variant='media' onSelect={handleClick}>
      <div className='flex h-full w-full playlist-item items-center space-x-2'>
        <OptimizedThumbnail
          src={thumbnailUrl}
          alt={title}
          className='cursor-pointer'
        />
        <div className='min-w-0 grow'>
          <div
            ref={containerRef}
            className={`font-bold tracking-wide text-song-title ${
              isOverflowing ? 'marquee' : 'overflow-hidden'
            }`}>
            <span
              ref={textRef}
              className='inline-block cursor-pointer whitespace-nowrap'>
              {title}
            </span>
          </div>
          <div className='flex items-center gap-1.5 text-sm text-song-meta'>
            <KaraokeMark videoId={videoId} />
            <span className='truncate'>{author}</span>
          </div>
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
