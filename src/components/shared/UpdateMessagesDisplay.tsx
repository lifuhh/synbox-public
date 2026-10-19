import React from 'react'

import DotsLoader from '@/components/shared/DotsLoader'
import type { DotsLoaderSize } from '@/components/shared/DotsLoader'

const TEXT_SIZE_CLASS = {
  xs: 'text-xs leading-[1.4]',
  sm: 'text-sm leading-[1.45]',
  md: 'text-base leading-[1.55]',
  lg: 'text-lg leading-[1.6]',
  xl: 'text-xl leading-[1.65]',
} as const

// Whole class names, so Tailwind can see them
const MARGIN_CLASS = {
  2: 'my-2',
  4: 'my-4',
} as const

interface UpdateMessagesDisplayProps {
  isStreaming: boolean
  showLoader: boolean
  updateMessages: string[]
  loaderColor?: string
  loaderSize?: DotsLoaderSize
  textSize?: keyof typeof TEXT_SIZE_CLASS
  verticalMargin?: keyof typeof MARGIN_CLASS
}

const UpdateMessagesDisplay: React.FC<UpdateMessagesDisplayProps> = ({
  isStreaming,
  showLoader,
  updateMessages,
  loaderColor = '#fff',
  loaderSize = 'lg',
  textSize = 'lg',
  verticalMargin = 4,
}) => {
  const lastMessage = updateMessages.slice(-1)[0]

  return (
    <>
      {showLoader && (
        <div
          className={`mt-10 flex-center flex flex-col ${MARGIN_CLASS[verticalMargin]}`}>
          {isStreaming ? (
            updateMessages.length > 0 ? (
              <p className={TEXT_SIZE_CLASS[textSize]}>{lastMessage}</p>
            ) : (
              <p className={TEXT_SIZE_CLASS[textSize]}>
                Waiting for updates...
              </p>
            )
          ) : (
            <p className={TEXT_SIZE_CLASS[textSize]}>Cleaning up...</p>
          )}
          <DotsLoader color={loaderColor} size={loaderSize} />
        </div>
      )}
    </>
  )
}

export default UpdateMessagesDisplay
