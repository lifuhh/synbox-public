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

interface UpdateMessagesDisplayProps {
  isStreaming: boolean
  showLoader: boolean
  updateMessages: string[]
  loaderColor?: string
  loaderSize?: DotsLoaderSize
  textSize?: keyof typeof TEXT_SIZE_CLASS
  verticalMargin?: number | string
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

  const marginClass =
    typeof verticalMargin === 'number'
      ? `my-${verticalMargin}`
      : `my-[${verticalMargin}]`

  return (
    <>
      {showLoader && (
        <div className={`mt-10 flex-center flex flex-col ${marginClass}`}>
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
