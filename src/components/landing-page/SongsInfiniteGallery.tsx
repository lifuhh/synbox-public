import React from 'react'

import DotsLoader from '@/components/shared/DotsLoader'
import { useGetInfiniteGalleryPlaylist } from '@/lib/react-query/queriesAndMutations'
import type { InfiniteGalleryVideoItem } from '@/types'

import HomeFooter from '../shared/HomeFooter'
import { Spotlight } from '../ui/Spotlight'
import { VirtualInfiniteScrollGallery } from './VirtualInfiniteScrollGallery'

const SongsInfiniteGallery: React.FC = () => {
  const {
    data: infiniteGallerySongData,
    isLoading: isInfiniteGallerySongDataFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useGetInfiniteGalleryPlaylist()

  return (
    <section className='relative flex flex-wrap justify-between'>
      <Spotlight
        className='-top-80 left-40 scale-x-[-1] md:top-20 md:-left-40'
        fill='#580a24'
      />
      <div className='mx-auto h-[calc(100vh-200px)] max-w-full gap-2 px-8'>
        {infiniteGallerySongData && (
          <VirtualInfiniteScrollGallery
            items={infiniteGallerySongData.pages.flatMap((page) =>
              page.items.map((item): InfiniteGalleryVideoItem => ({
                title: item.title,
                channel: item.channel || 'Unknown',
                thumbnailUrl: item.thumbnailUrl,
                videoId: item.videoId,
              }))
            )}
            fetchNextPage={fetchNextPage}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
          />
        )}
        {isInfiniteGallerySongDataFetching && (
          <div className='my-0 flex w-full min-w-full items-center justify-center'>
            <DotsLoader color='#c2255c' size='lg' />
          </div>
        )}
        <HomeFooter />
      </div>
    </section>
  )
}

export default SongsInfiniteGallery
