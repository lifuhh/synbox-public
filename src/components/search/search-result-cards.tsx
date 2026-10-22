import { SparklesIcon } from 'lucide-react'

import {
  KaraokeLabelMark,
  KaraokePictureBadgeMark,
} from '@/components/shared/karaoke-badge'
import { SongMenu } from '@/components/watch/song-menu'
import type {
  LibrarySong,
  VideoSearchResult,
} from '@/lib/synbox-flask/discovery'

const Thumbnail = ({
  src,
  alt,
  videoId,
}: {
  src: string
  alt: string
  videoId: string
}) => (
  <div className='relative aspect-video w-full overflow-hidden rounded-lg bg-input'>
    {src !== '' && (
      <img
        src={src}
        alt={alt}
        loading='lazy'
        className='absolute inset-0 h-full w-full object-cover'
      />
    )}
    <KaraokePictureBadgeMark videoId={videoId} />
  </div>
)

// The hover surface's corners follow the picture's: its 8px radius plus the 8px padding
const CARD =
  'flex flex-col gap-2 rounded-2xl p-2 transition-colors hover:bg-muted/60'

// Two lines tall even when the title fits on one, so every card's next row lines up
const Title = ({ children }: { children: string }) => (
  <p className='line-clamp-2 min-h-[2lh] text-sm font-semibold text-foreground'>
    {children}
  </p>
)

export const VideoResultCard = ({
  result,
  onSelect,
}: {
  result: VideoSearchResult
  onSelect: (result: VideoSearchResult) => void
}) => (
  <button
    data-bench='search-result'
    type='button'
    onClick={() => {
      onSelect(result)
    }}
    className={`${CARD} text-left`}>
    <Thumbnail
      src={result.thumbnail_url}
      alt={result.title}
      videoId={result.video_id}
    />
    <Title>{result.title}</Title>
    <KaraokeLabelMark videoId={result.video_id} />
    <p className='truncate text-xs text-muted-foreground'>{result.channel}</p>
  </button>
)

export const LibrarySongCard = ({
  song,
  onPlay,
  onMoreLikeThis,
}: {
  song: LibrarySong
  onPlay: (videoId: string) => void
  onMoreLikeThis: (videoId: string) => void
}) => (
  <div className={CARD}>
    <button
      data-bench='search-result'
      type='button'
      onClick={() => {
        onPlay(song.video_id)
      }}
      className='flex flex-col gap-2 text-left'>
      <Thumbnail
        src={song.thumbnail_url}
        alt={song.title}
        videoId={song.video_id}
      />
      <Title>{song.title}</Title>
      <KaraokeLabelMark videoId={song.video_id} />
    </button>
    <div className='flex items-center gap-2'>
      <p className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>
        {song.artist}
      </p>
      <button
        type='button'
        aria-label='More Like This'
        title='More Like This'
        onClick={() => {
          onMoreLikeThis(song.video_id)
        }}
        className='-my-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-primary-text'>
        <SparklesIcon className='size-4' />
      </button>
      <SongMenu
        song={{
          author: song.artist,
          thumbnailUrl: song.thumbnail_url,
          title: song.title,
          videoId: song.video_id,
        }}
      />
    </div>
  </div>
)
