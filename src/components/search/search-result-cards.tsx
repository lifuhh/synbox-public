import { SparklesIcon } from 'lucide-react'

import type {
  LibrarySong,
  VideoSearchResult,
} from '@/lib/synbox-flask/discovery'

const Thumbnail = ({ src, alt }: { src: string; alt: string }) => (
  <div className='relative aspect-video w-full overflow-hidden rounded-md bg-input'>
    {src !== '' && (
      <img
        src={src}
        alt={alt}
        loading='lazy'
        className='absolute inset-0 h-full w-full object-cover'
      />
    )}
  </div>
)

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
    type='button'
    onClick={() => {
      onSelect(result)
    }}
    className='flex flex-col gap-2 rounded-lg p-2 text-left transition-colors hover:bg-muted/60'>
    <Thumbnail src={result.thumbnail_url} alt={result.title} />
    <Title>{result.title}</Title>
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
  <div className='flex flex-col gap-2 rounded-lg p-2 transition-colors hover:bg-muted/60'>
    <button
      type='button'
      onClick={() => {
        onPlay(song.video_id)
      }}
      className='flex flex-col gap-2 text-left'>
      <Thumbnail src={song.thumbnail_url} alt={song.title} />
      <Title>{song.title}</Title>
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
    </div>
  </div>
)
