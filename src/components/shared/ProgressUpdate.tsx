import { CheckCircle, Loader } from 'lucide-react'

import { cn } from '@/utils/cn'

export interface Step {
  id: string
  title: string
  status: 'pending' | 'active' | 'completed'
}

interface ProgressUpdateProps {
  steps: Step[]
}

export function ProgressUpdate({ steps }: ProgressUpdateProps) {
  return (
    <div className='flex-col space-y-8'>
      {steps.map((step) => (
        <div key={step.id} className='flex items-center space-x-4'>
          <div className='shrink-0'>
            {step.status === 'completed' && (
              <CheckCircle className='h-5 w-5 text-green-500' />
            )}
            {step.status === 'active' && (
              <Loader className='h-5 w-5 animate-spin text-white' />
            )}
            {step.status === 'pending' && (
              <div className='h-5 w-5 rounded-full border-2 border-gray-300' />
            )}
          </div>
          <div className='grow'>
            <p
              className={cn(
                'text-sm font-medium',
                step.status === 'completed' && 'text-green-500',
                step.status === 'active' && 'text-white',
                step.status === 'pending' && 'text-gray-500'
              )}>
              {step.title}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
