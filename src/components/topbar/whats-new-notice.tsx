import { MegaphoneIcon } from 'lucide-react'
import { Link } from 'react-router'

import {
  UNREAD_LABEL,
  UnreadDot,
} from '@/components/generation/generation-panel'
import { useGeneration } from '@/lib/generation/store'
import { entryDate, whatsNewPath } from '@/lib/whats-new'
import type { WhatsNewEntry } from '@/lib/whats-new'
import { cn } from '@/utils/cn'

// The bell's key for an entry, kept unread-looking while the panel that read it stays open (GenerationState.unread)
export const whatsNewKey = (entry: WhatsNewEntry) => `whats-new:${entry.id}`

// The newest release's row in the bell, until the listener has seen it: it opens that entry on What's New. Laid out
// as the admin's notice rows are (admin-notices.tsx › NoticeRow)
export const WhatsNewNotice = ({ entry }: { entry: WhatsNewEntry }) => {
  const unread = useGeneration().unread.includes(whatsNewKey(entry))
  return (
    <ul aria-label='What’s New' className='flex flex-col p-2'>
      <li className='relative'>
        {unread && <UnreadDot className='top-1/2 left-1 -translate-y-1/2' />}
        <Link
          to={whatsNewPath(entry)}
          className='flex min-h-11 items-center gap-3 rounded-lg py-2 pr-2 pl-4 transition-colors hover:bg-accent focus-visible:bg-accent'>
          <span className='grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground'>
            <MegaphoneIcon className='size-4' aria-hidden />
          </span>
          <span className='flex min-w-0 flex-1 flex-col'>
            <span
              className={cn(
                'truncate text-sm',
                unread ? 'text-foreground' : 'text-muted-foreground'
              )}>
              {unread && UNREAD_LABEL}
              What’s New · {entry.title}
            </span>
            <span className='text-xs text-muted-foreground'>
              {entryDate(entry.date)}
            </span>
          </span>
        </Link>
      </li>
    </ul>
  )
}
