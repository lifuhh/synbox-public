import { AnimatePresence, motion } from 'motion/react'
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate } from 'react-router'

import DotsLoader from '@/components/shared/DotsLoader'
import { useOverflow } from '@/hooks/useOverflow'
import type { InfiniteScrollGalleryProps } from '@/types'
import { cn } from '@/utils/cn'

const useResponsiveColumns = () => {
  const [columns, setColumns] = useState(3)

  useEffect(() => {
    const updateColumns = () => {
      const width = window.innerWidth
      if (width < 640) {
        setColumns(1)
      } else if (width < 1024) {
        setColumns(2)
      } else if (width < 1536) {
        setColumns(3)
      } else {
        setColumns(4)
      }
    }

    updateColumns()
    window.addEventListener('resize', updateColumns)
    return () => {
      window.removeEventListener('resize', updateColumns)
    }
  }, [])

  return columns
}

const useVirtualGrid = ({
  items,
  containerHeight,
  estimatedRowHeight = 280,
  columnsPerRow,
  overscan = 6,
}: {
  items: unknown[]
  containerHeight: number
  estimatedRowHeight?: number
  columnsPerRow: number
  overscan?: number
}) => {
  const [scrollTop, setScrollTop] = useState(0)

  const totalRows = Math.ceil(items.length / columnsPerRow)

  const visibleRange = useMemo(() => {
    const visibleRows = Math.ceil(containerHeight / estimatedRowHeight)

    const startRow = Math.max(
      0,
      Math.floor(scrollTop / estimatedRowHeight) - overscan
    )
    const endRow = Math.min(startRow + visibleRows + overscan * 2, totalRows)

    const startIndex = startRow * columnsPerRow
    const endIndex = Math.min(endRow * columnsPerRow, items.length)

    return { startIndex, endIndex, startRow, endRow }
  }, [
    scrollTop,
    estimatedRowHeight,
    containerHeight,
    totalRows,
    columnsPerRow,
    overscan,
    items.length,
  ])

  const totalHeight = totalRows * estimatedRowHeight

  return {
    visibleRange,
    totalHeight,
    setScrollTop,
    estimatedRowHeight,
  }
}

export const VirtualInfiniteScrollGallery = ({
  items,
  className,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
}: InfiniteScrollGalleryProps) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState(600)
  const [actualContentHeight, setActualContentHeight] = useState(0)

  const columns = useResponsiveColumns()

  const { visibleRange, totalHeight, setScrollTop, estimatedRowHeight } =
    useVirtualGrid({
      items,
      containerHeight,
      estimatedRowHeight: 280,
      columnsPerRow: columns,
      overscan: 6,
    })

  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.clientHeight)
      }
    }

    updateHeight()
    window.addEventListener('resize', updateHeight)
    return () => {
      window.removeEventListener('resize', updateHeight)
    }
  }, [])

  useEffect(() => {
    if (contentRef.current) {
      setActualContentHeight(contentRef.current.offsetHeight)
    }
  }, [visibleRange, items.length])

  const handleGalleryItemClick = useCallback(
    (videoId: string) => () => {
      navigate(`/v/${videoId}`, { state: { videoId } })
    },
    [navigate]
  )

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const { scrollTop } = e.currentTarget
      setScrollTop(scrollTop)

      const { scrollHeight } = e.currentTarget
      const { clientHeight } = e.currentTarget
      const scrollBottom = scrollTop + clientHeight

      if (
        scrollBottom >= scrollHeight - 400 &&
        hasNextPage &&
        !isFetchingNextPage
      ) {
        fetchNextPage()
      }
    },
    [setScrollTop, hasNextPage, isFetchingNextPage, fetchNextPage]
  )

  const visibleItems = items.slice(
    visibleRange.startIndex,
    visibleRange.endIndex
  )

  const offsetY = visibleRange.startRow * estimatedRowHeight

  const totalHeightWithLoader = totalHeight + (isFetchingNextPage ? 80 : 0)

  return (
    <div
      ref={containerRef}
      className={cn('custom-scrollbar overflow-auto px-4', className)}
      onScroll={handleScroll}
      style={{ height: '100%' }}>
      <div style={{ height: totalHeightWithLoader, position: 'relative' }}>
        <div
          ref={contentRef}
          className='flex flex-wrap py-2 pt-4'
          style={{
            transform: `translateY(${offsetY}px)`,
            position: 'relative',
          }}>
          {visibleItems.map((item, index) => {
            const actualIndex = visibleRange.startIndex + index
            return (
              <div
                key={item?.videoId}
                className='relative w-full p-3 sm:w-1/2 lg:w-1/3 xl:w-1/3 2xl:w-1/4'
                onMouseEnter={() => {
                  setHoveredIndex(actualIndex)
                }}
                onMouseLeave={() => {
                  setHoveredIndex(null)
                }}
                onClick={handleGalleryItemClick(item?.videoId)}>
                <AnimatePresence>
                  {hoveredIndex === actualIndex && (
                    <motion.span
                      className='absolute inset-0 block h-full w-full rounded-xl bg-primary/10'
                      layoutId={`hoverBackground-${item?.videoId}`}
                      initial={{ opacity: 0 }}
                      animate={{
                        opacity: 1,
                        transition: { duration: 0.08 },
                      }}
                      exit={{
                        opacity: 0,
                        transition: { duration: 0.08 },
                      }}
                    />
                  )}
                </AnimatePresence>
                <Card className='cursor-pointer bg-muted'>
                  <CardTitle className='mb-4 text-lg'>{item.title}</CardTitle>
                  <div className='relative overflow-hidden rounded-xl pb-[56.25%]'>
                    <img
                      className='absolute inset-0 h-full w-full object-cover'
                      src={item.thumbnailUrl}
                      alt={item.title}
                      loading='lazy'
                    />
                  </div>
                </Card>
              </div>
            )
          })}
        </div>

        {isFetchingNextPage && (
          <div
            className='absolute right-0 left-0 flex items-center justify-center py-4'
            style={{
              top: actualContentHeight + offsetY,
              height: '80px',
            }}>
            <DotsLoader size='xl' />
          </div>
        )}
      </div>
    </div>
  )
}

const Card = ({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) => (
  <div
    className={cn(
      'relative z-20 w-full playlist-item overflow-hidden rounded-xl border bg-card p-4 transition-colors duration-500 hover:border-ring',
      className
    )}>
    {children}
  </div>
)

const CardTitle = memo(
  ({ className, children }: { className?: string; children: string }) => {
    const textRef = useRef<HTMLSpanElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    useOverflow(textRef, containerRef, 'marquee')

    return (
      <div
        ref={containerRef}
        className={cn(
          'marquee font-bold tracking-wide text-zinc-100 unhighlightable',
          className
        )}>
        <span ref={textRef} className='whitespace-nowrap'>
          {children}
        </span>
      </div>
    )
  }
)
