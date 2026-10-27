import { FlagIcon, MailIcon, SparklesIcon } from 'lucide-react'
import { Link } from 'react-router'

import type { AdminNotice } from '@/lib/admin-notices'
import { NOTICE_TAB } from '@/lib/admin-notices'
import { useGetSongInfoBySongId } from '@/lib/react-query/queries-and-mutations'
import { cn } from '@/utils/cn'

const ICONS = {
  message: MailIcon,
  report: FlagIcon,
  request: SparklesIcon,
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
  return <>New message from {notice.name || 'a guest'}</>
}

// The admin's part of the bell: one row per new contact message, report or request, opening its /admin tab
export const AdminNoticeList = ({
  notices,
}: {
  notices: readonly AdminNotice[]
}) => (
  <section aria-label='Admin' className='flex flex-col gap-1 p-2'>
    <h2 className='px-2 pt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase'>
      Admin
    </h2>
    <ul className='flex flex-col'>
      {notices.map((notice) => {
        const Icon = ICONS[notice.kind]
        return (
          <li key={`${notice.kind}-${notice.id}`}>
            <Link
              to={`/admin?tab=${NOTICE_TAB[notice.kind]}`}
              className='flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent focus-visible:bg-accent'>
              <span className='relative grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground'>
                <Icon className='size-4' aria-hidden />
                {notice.unread && (
                  <span
                    aria-hidden
                    className='absolute top-0 right-0 size-2 rounded-full bg-primary'
                  />
                )}
              </span>
              <span className='flex min-w-0 flex-1 flex-col'>
                <span
                  className={cn(
                    'truncate text-sm',
                    notice.unread ? 'text-foreground' : 'text-muted-foreground'
                  )}>
                  <NoticeTitle notice={notice} />
                  {notice.unread && <span className='sr-only'> (new)</span>}
                </span>
                <span className='text-xs text-muted-foreground'>
                  {ago(notice.at)}
                </span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  </section>
)
