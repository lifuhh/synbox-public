import {
  EllipsisIcon,
  EllipsisVerticalIcon,
  MenuIcon,
  ShareIcon,
  SquarePlusIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { installGuide } from '@/lib/install-guide'
import type { StepIcon } from '@/lib/install-guide'
import { track } from '@/lib/usage'

const ICONS: Record<StepIcon, LucideIcon> = {
  'add-square': SquarePlusIcon,
  menu: MenuIcon,
  more: EllipsisIcon,
  'more-vertical': EllipsisVerticalIcon,
  share: ShareIcon,
}

// Install App where the browser has no prompt to open: its own steps, numbered, each control drawn as it looks
// there; or, where it can't install, which browser to open the site in
const InstallGuideDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const { openIn, steps } = useMemo(
    () => installGuide(navigator.userAgent, navigator.maxTouchPoints),
    []
  )
  useEffect(() => {
    if (open) {
      track({ name: 'install_prompt', props: { method: 'guide' } })
    }
  }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install Synbox</DialogTitle>
          <DialogDescription>
            {openIn === undefined
              ? 'Full screen, like an app'
              : `Not possible in this browser. Open this page in ${openIn}`}
          </DialogDescription>
        </DialogHeader>
        {steps.length > 0 && (
          <ol className='flex flex-col gap-3 text-base'>
            {steps.map(({ verb, name, icon, note }, index) => {
              const Icon = icon === undefined ? null : ICONS[icon]
              return (
                <li key={name} className='flex items-start gap-3'>
                  <span
                    aria-hidden
                    className='grid size-6 shrink-0 place-items-center rounded-full bg-primary-subtle text-sm font-semibold text-primary-text tabular-nums'>
                    {index + 1}
                  </span>
                  <span className='flex min-w-0 flex-wrap items-center gap-x-1.5'>
                    {verb}
                    {Icon !== null && (
                      <Icon className='size-5 shrink-0 text-primary-text' />
                    )}
                    <strong>{name}</strong>
                    {note !== undefined && (
                      <span className='text-sm text-muted-foreground'>
                        {note}
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default InstallGuideDialog
