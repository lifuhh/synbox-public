import { Link } from 'react-router'

import { ListenCount } from '@/components/shared/listen-count'
import { SongMenu } from '@/components/watch/song-menu'
import type {
  LibrarySong,
  VideoSearchResult,
} from '@/lib/synbox-flask/discovery'

const Thumbnail = ({ src }: { src: string }) => (
  <div className='relative aspect-video w-full overflow-hidden rounded-lg bg-thumbnail-placeholder'>
    {src !== '' && (
      <img
        decoding='async'
        src={src}
        // The card's title names the song; the picture would say it twice
        alt=''
        loading='lazy'
        className='absolute inset-0 h-full w-full object-cover'
      />
    )}
  </div>
)

// The hover surface's corners follow the picture's: its 8px radius plus the 8px padding
const CARD =
  'flex flex-col gap-2 rounded-2xl p-2 transition-colors hover:bg-muted/60'

// Two lines tall even when the title fits on one, so every card's next row lines up
const Title = ({ children }: { children: string }) => (
  <p className='line-clamp-2 min-h-[2lh] text-sm font-semibold wrap-anywhere text-foreground'>
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
    <Thumbnail src={result.thumbnail_url} />
    <Title>{result.title}</Title>
    <p className='truncate text-xs text-muted-foreground'>{result.channel}</p>
  </button>
)

export const LibrarySongCard = ({
  song,
  onMoreLikeThis,
}: {
  song: LibrarySong
  onMoreLikeThis: (videoId: string) => void
}) => (
  <div className={CARD}>
    <Link
      data-bench='search-result'
      to={`/v/${song.video_id}`}
      state={{ videoId: song.video_id }}
      className='flex flex-col gap-2 text-left'>
      <Thumbnail src={song.thumbnail_url} />
      <Title>{song.title}</Title>
    </Link>
    {/* The channel is the title's second line, at the card's gap; the one menu button is centred on it, its 40px box
        (44 on touch) reaching above and below without making the line taller */}
    <div className='flex items-center gap-2'>
      <p className='flex min-w-0 flex-1 items-center gap-2.5 text-xs text-muted-foreground'>
        <ListenCount videoId={song.video_id} />
        <span className='truncate'>{song.artist}</span>
      </p>
      <SongMenu
        className='-my-3 -mr-2 touch:-my-3.5 touch:size-11'
        song={{
          author: song.artist,
          thumbnailUrl: song.thumbnail_url,
          title: song.title,
          videoId: song.video_id,
        }}
        onMoreLikeThis={() => {
          onMoreLikeThis(song.video_id)
        }}
      />
    </div>
  </div>
)
