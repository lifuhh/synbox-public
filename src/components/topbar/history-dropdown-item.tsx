import { PlayIcon } from 'lucide-react'
import React, { useRef } from 'react'
import { useNavigate } from 'react-router'

import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useOverflow } from '@/hooks/use-overflow'

import OptimizedThumbnail from '../shared/optimized-thumbnail'
import { Button } from '../ui/button'

interface HistoryDropdownItemProps {
  videoId: string
  title: string
  author: string
  thumbnailUrl: string
}

const HistoryDropdownItem: React.FC<HistoryDropdownItemProps> = ({
  videoId,
  title,
  author,
  thumbnailUrl,
}) => {
  const navigate = useNavigate()
  const textRef = useRef<HTMLSpanElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const isOverflowing = useOverflow(textRef, containerRef)

  const handleClick = () => {
    void navigate(`/v/${videoId}`)
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
          <div className='truncate text-sm text-song-meta'>{author}</div>
        </div>
        <Button asChild variant='row-icon' size='icon' className='shrink-0'>
          <span aria-hidden='true'>
            <PlayIcon className='size-6 shrink-0 fill-current' />
          </span>
        </Button>
      </div>
    </DropdownMenuItem>
  )
}

export default HistoryDropdownItem
