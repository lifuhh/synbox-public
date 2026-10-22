import { useState } from 'react'

import HeroGenerateLyricsDefault from './hero-generate-lyrics-default'

const HeroGenerateLyricsSection = () => {
  const [inputVideoId, setInputVideoId] = useState<string>('')

  return (
    <section className='mt-(--topbar-h) px-4'>
      <HeroGenerateLyricsDefault
        setInputVideoId={setInputVideoId}
        inputVideoId={inputVideoId}
      />
    </section>
  )
}
export default HeroGenerateLyricsSection
