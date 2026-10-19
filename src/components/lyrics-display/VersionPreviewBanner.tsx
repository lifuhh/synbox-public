import { Link, useSearchParams } from 'react-router'

import { useGetLyricsVersion } from '@/lib/react-query/queriesAndMutations'

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
      className='fixed top-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-md border border-accent bg-card px-4 py-2 text-sm text-foreground shadow-md'>
      <span className='font-semibold'>
        {error ? `Version ${version} Not Found` : `Preview: Version ${version}`}
      </span>
      <Link className='underline' to={`/v/${videoId}/versions`}>
        All Versions
      </Link>
    </output>
  )
}

export default VersionPreviewBanner
