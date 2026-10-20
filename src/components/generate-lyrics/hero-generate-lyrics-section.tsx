import { useState } from 'react'

import HeroGenerateLyricsError from '@/components/generate-lyrics/hero-generate-lyrics-error'
import HeroGenerateLyricsExists from '@/components/generate-lyrics/hero-generate-lyrics-exists'
import { useAppContext } from '@/context/app-context'

import HeroGenerateLyricsDefault from './hero-generate-lyrics-default'

const HeroGenerateLyricsSection = () => {
  const { processingStage, setProcessingStage } = useAppContext()
  const [inputVideoId, setInputVideoId] = useState<string>('')

  const renderComponent = () => {
    switch (processingStage) {
      case 1: {
        return (
          <HeroGenerateLyricsDefault
            setProcessingStage={setProcessingStage}
            setInputVideoId={setInputVideoId}
            inputVideoId={inputVideoId}
          />
        )
      }
      case 2: {
        return <HeroGenerateLyricsExists />
      }
      case 200: {
        return <HeroGenerateLyricsExists />
      }
      case 404: {
        return <HeroGenerateLyricsError />
      }
      default: {
        return null
      }
    }
  }

  return <section className='mt-(--topbar-h) px-4'>{renderComponent()}</section>
}
export default HeroGenerateLyricsSection
