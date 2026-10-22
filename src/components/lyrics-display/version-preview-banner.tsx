import { Link, useSearchParams } from 'react-router'

import { AdminMark } from '@/components/shared/admin-mark'
import { useGetLyricsVersion } from '@/lib/react-query/queries-and-mutations'

export const parsePreviewVersion = (value: string | null) =>
  value !== null && /^\d+$/u.test(value) ? Number(value) : null

// Shown on /v/<id>?version=n, so a stored version is never mistaken for the song's real lyrics.
const VersionPreviewBanner = ({ videoId }: { videoId: string }) => {
  const [searchParams] = useSearchParams()
  const version = parsePreviewVersion(searchParams.get('version'))
  const { error } = useGetLyricsVersion(videoId, version)

  if (version === null) {
    return null
  }

  return (
    <output
      data-preview-banner
      className='fixed top-[calc(var(--topbar-h)+0.5rem+var(--notices-h,0px))] left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-md bg-card px-4 py-2 text-sm whitespace-nowrap text-foreground shadow-md portrait:top-auto portrait:bottom-(--stage-chrome-h)'>
      <AdminMark className='size-3.5' />
      <span className='-ml-1.5 font-semibold'>
        {error ? `Version ${version} Not Found` : `Preview: Version ${version}`}
      </span>
      <Link className='-my-2 py-2 underline' to={`/v/${videoId}/versions`}>
        All Versions
      </Link>
    </output>
  )
}

export default VersionPreviewBanner
