import {
  BookmarkCheckIcon,
  BookmarkIcon,
  HouseIcon,
  LanguagesIcon,
  MessageSquareTextIcon,
  ReplyIcon,
} from 'lucide-react'
import React from 'react'

import { ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type ButtonId =
  | 'returnHomeButton'
  | 'translationLanguage'
  | 'translation'
  | 'lyrics'
  | 'romaji'
  | 'bookmarkButton'
  | 'shareButton'

interface ButtonState {
  currentVideo?: {
    videoId: string
  } | null
  isFavorite: (videoId: string) => boolean
  isTranslationEnglish: boolean
  isRomajiVisible: boolean
  isLyricsVisible: boolean
  isTranslationVisible: boolean
}

interface ButtonProps extends ButtonState {
  id: ButtonId
  value: string
  onClick?: () => void
  isActive: boolean
  isHovered: boolean
}

interface ButtonConfigProps extends ButtonState {
  id: ButtonId
  isActive: boolean
  isHovered: boolean
}

const BASE_STYLES = 'invisible-ring h-10 w-10 cursor-pointer rounded-lg'

const EXCLUDED_BUTTONS: ButtonId[] = [
  'translationLanguage',
  'returnHomeButton',
  'shareButton',
  'bookmarkButton',
]

const getButtonProps = ({
  id,
  isActive,
  isHovered,
  currentVideo,
  isFavorite,
  isTranslationEnglish,
  isRomajiVisible,
  isLyricsVisible,
  isTranslationVisible,
}: ButtonConfigProps) => {
  const isDisabled = id === 'bookmarkButton' && !currentVideo

  const baseConfig = {
    className: `${BASE_STYLES} ${
      isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'
    } ${
      !EXCLUDED_BUTTONS.includes(id)
        ? 'bg-primary data-[state=off]:bg-secondary/10'
        : 'bg-primary text-white'
    }`,
    style: {
      opacity: isDisabled
        ? 0.3
        : EXCLUDED_BUTTONS.includes(id) || isActive
          ? 1
          : isHovered
            ? 0.6
            : 0.4,
      transform: isHovered ? 'scale(1.1)' : 'scale(1)',
      transition: 'opacity 0.15s ease-in-out, transform 0.15s ease-in-out',
    },
    disabled: isDisabled,
  }

  const buttonConfigs = {
    returnHomeButton: {
      icon: <HouseIcon className='size-6 shrink-0' />,
      tooltip: 'Return to Home Page',
    },
    translationLanguage: {
      icon: isTranslationEnglish ? (
        <h1 className='text-xl'>EN</h1>
      ) : (
        <h1 className='text-xl font-extrabold'>中</h1>
      ),
      tooltip: isTranslationEnglish
        ? 'View Chinese Translations'
        : 'View English Translations',
    },
    translation: {
      icon: <LanguagesIcon className='size-6 shrink-0' />,
      tooltip: isTranslationVisible ? 'Hide Translations' : 'Show Translations',
    },
    lyrics: {
      icon: <MessageSquareTextIcon className='size-6 shrink-0' />,
      tooltip: isLyricsVisible ? 'Hide Lyrics' : 'Show Lyrics',
    },
    romaji: {
      icon: <h1 className='text-xl'>R</h1>,
      tooltip: isRomajiVisible ? 'Hide Romaji' : 'Show Romaji',
    },
    bookmarkButton: {
      icon: currentVideo ? (
        isFavorite(currentVideo.videoId) ? (
          <BookmarkCheckIcon className='size-6 shrink-0 fill-current [&>path:last-child]:stroke-background' />
        ) : (
          <BookmarkIcon className='size-6 shrink-0 -scale-x-100' />
        )
      ) : (
        <BookmarkIcon className='size-6 shrink-0 -scale-x-100' />
      ),
      tooltip: !currentVideo
        ? 'No video selected'
        : currentVideo && isFavorite(currentVideo.videoId)
          ? 'Remove from Bookmarks'
          : 'Add to Bookmarks',
    },
    shareButton: {
      icon: <ReplyIcon className='size-6 shrink-0 -scale-x-100' />,
      tooltip: 'Copy URL',
    },
  }

  return {
    ...baseConfig,
    ...buttonConfigs[id],
  }
}

export const LyricsVisibilityControlButton: React.FC<ButtonProps> = ({
  id,
  value,
  onClick,
  isActive,
  isHovered,
  currentVideo,
  isFavorite,
  isTranslationEnglish,
  isRomajiVisible,
  isLyricsVisible,
  isTranslationVisible,
}) => {
  const buttonProps = getButtonProps({
    id,
    isActive,
    isHovered,
    currentVideo,
    isFavorite,
    isTranslationEnglish,
    isRomajiVisible,
    isLyricsVisible,
    isTranslationVisible,
  })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToggleGroupItem
          value={value}
          onClick={onClick}
          variant='default'
          aria-label={buttonProps.tooltip}
          disabled={buttonProps.disabled}
          className={buttonProps.className}
          style={buttonProps.style}>
          {buttonProps.icon}
        </ToggleGroupItem>
      </TooltipTrigger>
      <TooltipContent
        side='right'
        align='start'
        sideOffset={6}
        alignOffset={-4}
        className='border-none bg-primary unhighlightable'>
        {buttonProps.tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
