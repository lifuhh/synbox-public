import { Link } from 'react-router'

import { Button } from '@/components/ui/button'

// What someone without access sees on an admin-only page
const Forbidden = () => (
  <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
    <title>403 Access Forbidden · Synbox</title>
    <p className='text-7xl font-bold text-muted-foreground tabular-nums'>403</p>
    <h1 className='text-xl font-semibold text-foreground'>Access Forbidden</h1>
    <p className='text-sm text-muted-foreground'>
      You don&apos;t have permission to view this page
    </p>
    <Button asChild variant='outline'>
      <Link to='/'>Go Home</Link>
    </Button>
  </div>
)

export default Forbidden
