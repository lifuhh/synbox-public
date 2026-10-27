import { FlagIcon, MailIcon, MessageSquareIcon, MusicIcon } from 'lucide-react'
import { Link } from 'react-router'

import {
  UNREAD_LABEL,
  UnreadDot,
} from '@/components/generation/generation-panel'
import { Button } from '@/components/ui/button'
import type { AdminNotice } from '@/lib/admin-notices'
import { NOTICE_TAB, noticeKey, useClearReadNotices } from '@/lib/admin-notices'
import { useGeneration } from '@/lib/generation/store'
import { useGetSongInfoBySongId } from '@/lib/react-query/queries-and-mutations'
import { cn } from '@/utils/cn'

const ICONS = {
  feedback: MessageSquareIcon,
  message: MailIcon,
  report: FlagIcon,
  request: MusicIcon,
} as const

const ago = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) {
    return 'Just now'
  }
  if (minutes < 60) {
    return `${minutes} min ago`
  }
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

const ReportTitle = ({ videoId }: { videoId: string }) => {
  const { data } = useGetSongInfoBySongId(videoId)
  return <>New report on {data?.title ?? 'a song'}</>
}

const NoticeTitle = ({ notice }: { notice: AdminNotice }) => {
  if (notice.kind === 'report' && notice.videoId !== null) {
    return <ReportTitle videoId={notice.videoId} />
  }
  if (notice.kind === 'request') {
    return <>{notice.name || 'Someone'} asked for more songs</>
  }
  if (notice.kind === 'feedback') {
    return <>New feedback from {notice.name || 'Anonymous'}</>
  }
  return <>New message from {notice.name || 'a guest'}</>
}

// A notice the open panel found unread (GenerationState.unread) keeps its dot and bright title until the panel
// closes, though opening it read them all
const NoticeRow = ({ notice }: { notice: AdminNotice }) => {
  const unread = useGeneration().unread.includes(noticeKey(notice))
  const Icon = ICONS[notice.kind]
  return (
    <li className='relative'>
      {unread && <UnreadDot className='top-1/2 left-1 -translate-y-1/2' />}
      <Link
        to={`/admin?tab=${NOTICE_TAB[notice.kind]}`}
        className='flex min-h-11 items-center gap-3 rounded-lg py-2 pr-2 pl-4 transition-colors hover:bg-accent focus-visible:bg-accent'>
        <span className='grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground'>
          <Icon className='size-4' aria-hidden />
        </span>
        <span className='flex min-w-0 flex-1 flex-col'>
          <span
            className={cn(
              'truncate text-sm',
              unread ? 'text-foreground' : 'text-muted-foreground'
            )}>
            {unread && UNREAD_LABEL}
            <NoticeTitle notice={notice} />
          </span>
          <span className='text-xs text-muted-foreground'>
            {ago(notice.at)}
          </span>
        </span>
      </Link>
    </li>
  )
}

// The admin's part of the bell: one row per recent contact message, report, request or feedback, opening its /admin
// tab. Clear Read only where the Worker keeps it (`clearable`), and only once something is read
export const AdminNoticeList = ({
  notices,
  clearable,
}: {
  notices: readonly AdminNotice[]
  clearable: boolean
}) => {
  const { mutate: clearRead } = useClearReadNotices()
  return (
    <section
      aria-labelledby='admin-notices-heading'
      className='flex flex-col gap-1 p-2'>
      <div className='flex min-h-8 items-center justify-between gap-2 pl-4'>
        <h2
          id='admin-notices-heading'
          className='text-xs font-medium tracking-wide text-muted-foreground uppercase'>
          Admin
        </h2>
        {clearable && notices.some((notice) => !notice.unread) && (
          <Button
            variant='overlay-muted'
            size='sm'
            className='touch:h-11'
            onClick={() => {
              clearRead()
            }}>
            Clear Read
          </Button>
        )}
      </div>
      <ul aria-labelledby='admin-notices-heading' className='flex flex-col'>
        {notices.map((notice) => (
          <NoticeRow key={noticeKey(notice)} notice={notice} />
        ))}
      </ul>
    </section>
  )
}
