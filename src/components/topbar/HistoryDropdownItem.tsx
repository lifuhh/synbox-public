import { PlayIcon } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useOverflow } from '@/hooks/useOverflow'

import OptimizedThumbnail from '../shared/OptimizedThumbnail'
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
  const [isOverflowing, setIsOverflowing] = useState(false)

  const handleRowClick = (videoId: string) => () => {
    navigate(`/v/${videoId}`)
  }

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
    navigate(`/v/${videoId}`)
  }

  return (
    <DropdownMenuItem className='p-2'>
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
            className={`font-bold tracking-wide text-zinc-100 ${
              isOverflowing ? 'marquee' : 'overflow-hidden'
            }`}
            onClick={handleClick}>
            <span
              ref={textRef}
              className={`inline-block cursor-pointer whitespace-nowrap ${
                isOverflowing ? 'marquee-content' : ''
              }`}>
              {title}
            </span>
          </div>
          <div className='truncate text-sm text-gray-400'>{author}</div>
        </div>
        <Button
          variant='link'
          size='icon'
          className='shrink-0 bg-secondary'
          onClick={handleRowClick(videoId)}>
          <PlayIcon className='size-6 shrink-0 fill-current' />
        </Button>
      </div>
    </DropdownMenuItem>
  )
}

export default HistoryDropdownItem
