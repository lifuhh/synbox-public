import { Link } from 'react-router'

import { Button } from '@/components/ui/button'

// An address that is no page of the app (a mistyped or outdated link). It says so and offers the two ways on,
// instead of opening Home under an address that doesn't match it. `noindex`: the host answers every app
// address with the shell and a 200, so a search engine is told here not to keep it
const NotFound = () => (
  <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
    <title>Page Not Found · Synbox</title>
    <meta name='robots' content='noindex' />
    <p className='text-7xl font-bold text-muted-foreground tabular-nums'>404</p>
    <h1 className='text-xl font-semibold text-foreground'>Page Not Found</h1>
    <p className='text-sm text-muted-foreground'>
      This link doesn&apos;t lead anywhere
    </p>
    <div className='flex items-center gap-2'>
      <Button asChild variant='outline'>
        <Link to='/'>Go Home</Link>
      </Button>
      <Button asChild variant='ghost'>
        <Link to='/search'>Search</Link>
      </Button>
    </div>
  </div>
)

export default NotFound
