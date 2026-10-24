import type { ReactNode } from 'react'
import { Link } from 'react-router'

import {
  KaraokeThumbBadgeMark,
  KaraokeLabelMark,
} from '@/components/shared/karaoke-badge'
import { ListenCount } from '@/components/shared/listen-count'
import type { ListSong } from '@/lib/listening/model'
import type { OpenedBy } from '@/lib/listening/store'
import { songPath, songState } from '@/lib/listening/store'
import { bracketStart } from '@/utils'
import { cn } from '@/utils/cn'

const titleTone = (current: boolean, played: boolean) => {
  if (current) {
    return 'text-primary-text'
  }
  return played ? 'text-muted-foreground' : 'text-foreground'
}

const pictureClass = (large: boolean, played: boolean) =>
  cn(
    'relative aspect-video shrink-0 bg-thumbnail-placeholder',
    played && 'opacity-50',
    large ? 'w-[min(10.5rem,48%)] rounded-lg' : 'w-20 rounded-sm min-[360px]:w-24'
  )

// A song in a list: a 96×54 thumbnail (16:9) with the karaoke edge, then the title on up to two lines and
// the channel, the whole row opening the song. `lead` sits before the picture (a drag handle, a number),
// `actions` after the text. Rows are 8px padded; the thumbnail's 4px corners plus that padding make the
// row's 12px ones
export const SongRow = ({
  song,
  lead,
  actions,
  current = false,
  played = false,
  onOpen,
  openedBy,
  className,
  as: Root = 'li',
  large = false,
  to,
  picture,
  note,
}: {
  song: ListSong
  lead?: ReactNode
  actions?: ReactNode
  // The song playing now: marked, and not a link to itself
  current?: boolean
  // A song the playlist being played has played: the picture dims and the title drops to the channel's colour,
  // so its text still reads at 4.5:1
  played?: boolean
  onOpen?: () => void
  // A queued song's row: opening it keeps the playlist being played waiting
  openedBy?: OpenedBy
  className?: string
  // A row inside another list item (a sortable row) is a div
  as?: 'li' | 'div'
  // The watch page's right-hand column, as on YouTube: a picture almost half the row wide, the text beside
  // its top
  large?: boolean
  // Somewhere other than the song's player (its reader, offline), with the picture saved for it there
  to?: string
  picture?: string | null
  // A line under the channel: the lyric a search matched
  note?: string
}) => {
  const body = (
    <>
      <span
        className={pictureClass(large, played)}>
        {/* YouTube's 320x180 picture: the song's own thumbnail URL is often the 1280x720 one, and decoding a
          list of those for a 96px box stalls a phone's scrolling */}
        {picture !== null && (
          <img
            src={
              picture ?? `https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg`
            }
            alt=''
            width='320'
            height='180'
            loading='lazy'
            decoding='async'
            className='size-full rounded-inherit object-cover'
          />
        )}
        <KaraokeThumbBadgeMark videoId={song.videoId} />
      </span>
      <span
        className={cn(
          'flex min-w-0 flex-1 flex-col',
          large ? 'gap-1 self-start' : 'gap-0.5'
        )}>
        <span
          className={cn(
            'text-sm leading-5 text-pretty',
            large ? 'line-clamp-3 font-semibold' : 'line-clamp-2 font-medium',
            // A title with no spaces (a romanised one) breaks anywhere, so the clamp can end it in an ellipsis
            'wrap-anywhere',
            titleTone(current, played),
            bracketStart(song.title)
          )}>
          {song.title}
        </span>
        <KaraokeLabelMark videoId={song.videoId} />
        <span className='flex min-w-0 items-center gap-2.5 text-xs text-muted-foreground'>
          <ListenCount videoId={song.videoId} />
          <span className={cn('truncate', bracketStart(song.author))}>
            {song.author}
          </span>
        </span>
        {note !== undefined && (
          <span className='truncate text-xs text-primary-text italic'>
            “{note}”
          </span>
        )}
      </span>
    </>
  )
  return (
    <Root
      className={cn(
        'group/row flex items-center gap-1 rounded-xl transition-colors pointer-fine:has-[a:hover]:bg-accent',
        // A big row's menu sits at the top beside the title, as on YouTube
        large && 'items-start',
        current && 'bg-accent',
        className
      )}>
      {lead}
      {current ? (
        <div
          aria-current='true'
          className={cn(
            'flex min-w-0 flex-1 items-center gap-3 p-2',
            large && 'gap-3 p-1.5'
          )}>
          {body}
        </div>
      ) : (
        <Link
          to={to ?? songPath(song.videoId)}
          state={
            to === undefined ? songState(song.videoId, openedBy) : undefined
          }
          onClick={onOpen}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden',
            large && 'gap-3 p-1.5'
          )}>
          {body}
        </Link>
      )}
      {/* A big row's menu on the title's first line: the 40px button centred on its 20px line, 6px into the
          row's padding */}
      {large && actions !== undefined ? (
        <div className='-mt-1'>{actions}</div>
      ) : (
        actions
      )}
    </Root>
  )
}
