import { Link } from 'react-router'

import { Button } from '@/components/ui/button'

// A page that stands in for the one asked for (404, 403): its title, one line on the way on, and Go Home. Centred in
// the space under the top bar and above the tabs, at least a screen tall, so it centres whether the page scrolls
// itself or the document does (DocScroll)
export const StatusPage = ({
  title,
  line,
  children,
}: {
  title: string
  line: string
  children?: React.ReactNode
}) => (
  <div className='flex min-h-(--app-h) w-full flex-1 flex-col items-center justify-center gap-3 px-4 pt-page-top pb-page-bottom text-center'>
    {children}
    <h1 className='text-2xl font-bold tracking-tight text-pretty text-foreground sm:text-3xl'>
      {title}
    </h1>
    <p className='text-base text-pretty text-muted-foreground'>{line}</p>
    <Button asChild variant='outline' className='mt-3'>
      <Link to='/'>Go Home</Link>
    </Button>
  </div>
)
