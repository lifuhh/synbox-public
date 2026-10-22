import { SettingsIcon } from 'lucide-react'

import { cn } from '@/utils/cn'

// A small gear on anything only admins see, so an admin can tell an admin tool from a visitor's feature
export const AdminMark = ({ className }: { className?: string }) => (
  <SettingsIcon
    aria-hidden='true'
    className={cn('size-3 shrink-0 text-muted-foreground', className)}
  />
)

// The gear in an icon button's top corner: the button's own icon stays centred. The button must be `relative`
export const AdminCornerMark = () => (
  <AdminMark className='absolute top-0.5 right-0.5 size-3' />
)
