import type {
  LibrarySong,
  VideoSearchResult,
} from '@/lib/synbox-flask/discovery'

const DIFFICULTY_LABELS = {
  advanced: 'Advanced',
  beginner: 'Beginner',
  intermediate: 'Intermediate',
} as const
const VERSION_LABELS = { live: 'Live', tv_size: 'TV Size' } as const
const VOCAL_LABELS = {
  female: 'Female Vocal',
  male: 'Male Vocal',
  mixed: 'Mixed Vocals',
  synth: 'Vocal Synth',
} as const

const titleCase = (word: string) =>
  word.charAt(0).toUpperCase() + word.slice(1).split('_').join(' ')

const Badge = ({
  label,
  strong = false,
}: {
  label: string
  strong?: boolean
}) => (
  <span
    className={`rounded-sm px-1.5 py-0.5 text-xs ${strong ? 'bg-primary/90 text-foreground' : 'bg-muted text-muted-foreground'}`}>
    {label}
  </span>
)

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
    <p className='line-clamp-2 text-sm font-semibold text-foreground'>
      {result.title}
    </p>
    <p className='truncate text-xs text-muted-foreground'>{result.channel}</p>
    <div className='flex flex-wrap gap-1'>
      {result.processed ? (
        <Badge label='Ready To Sing' strong />
      ) : (
        <Badge label='Add Song' />
      )}
      {result.is_cover === true && <Badge label='Cover' />}
      {result.version !== null && result.version !== 'full' && (
        <Badge label={VERSION_LABELS[result.version]} />
      )}
    </div>
  </button>
)

export const LibrarySongCard = ({
  song,
  vocalUnknown = false,
  onPlay,
  onMoreLikeThis,
}: {
  song: LibrarySong
  vocalUnknown?: boolean
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
      <p className='line-clamp-2 text-sm font-semibold text-foreground'>
        {song.title}
      </p>
      <p className='truncate text-xs text-muted-foreground'>{song.artist}</p>
    </button>
    <div className='flex flex-wrap gap-1'>
      {song.mood !== null && <Badge label={titleCase(song.mood)} />}
      {song.vocal !== 'unknown' && <Badge label={VOCAL_LABELS[song.vocal]} />}
      {vocalUnknown && <Badge label='Vocalist Unknown' />}
      {song.difficulty !== null && (
        <Badge label={DIFFICULTY_LABELS[song.difficulty]} />
      )}
      {song.explicit && <Badge label='Explicit' />}
    </div>
    <button
      type='button'
      onClick={() => {
        onMoreLikeThis(song.video_id)
      }}
      className='self-start text-xs text-primary hover:underline'>
      More Like This
    </button>
  </div>
)
