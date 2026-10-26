import { useState } from 'react'

import { BoxScrollbar } from '@/components/shared/doc-scroll'
import { SiteLinks } from '@/components/shared/site-links'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

const STEPS = [
  {
    text: 'Any Japanese song on YouTube, 1 to 8 minutes long.',
    title: 'Paste a Link',
  },
  {
    text: 'The song is transcribed and aligned to its lyrics, word by word.',
    title: 'Lyrics Are Timed',
  },
  {
    text: 'Each word fills as it is sung, with furigana, romaji and an English or Chinese translation.',
    title: 'Sing Along',
  },
]

const FAQS = [
  {
    answer:
      "When no published lyrics match, they come from speech recognition, and long intros, loud backing tracks or fast singing trip it up. Report Issue under the song's More menu flags it for a fix.",
    question: 'Why Are Some Lyrics Wrong?',
  },
  {
    answer:
      'Japanese songs on YouTube, 1 to 8 minutes long, that the uploader lets other sites play. Age-restricted videos only play on YouTube.',
    question: 'Which Videos Work?',
  },
  {
    answer:
      'Songs already in the library are free for everyone. Adding a new song takes one free try a day; signing in gives you more.',
    question: 'Does It Cost Anything?',
  },
  {
    answer:
      "Yes. Add Synbox to your home screen from your browser's share menu, and it opens full screen like an app.",
    question: 'Can I Install It?',
  },
]

// The stack in general terms: languages, kinds of AI, and the companies whose platforms it runs on. No specific
// library or model of the lyrics pipeline, since that is what someone would copy. Each order is measured for the
// fewest rows with no chip alone on one at 320, 390, 844 and 1440 wide (Platforms: 2+2+3+3, 3+3+4, 5+5, 5+5)
const BUILT_WITH = [
  {
    group: 'Code',
    names: [
      'TypeScript',
      'SQL',
      'React',
      'Vite',
      'Python',
      'Flask',
      'Better Auth',
    ],
  },
  {
    group: 'AI',
    names: ['LLMs', 'Speech Recognition', 'NLP', 'Agentic Coding', 'Evals'],
  },
  {
    group: 'Platforms',
    names: [
      'OpenAI',
      'Anthropic Claude',
      'Google Cloud',
      'YouTube Data API',
      'ElevenLabs',
      'Cloudflare',
      'Netlify',
      'TypeSafe Jev',
      'Appwrite',
      'Sentry',
    ],
  },
]

const HEADING = 'text-sm font-semibold tracking-wide text-muted-foreground'

// One reading column at every width (42rem, about 70 characters a line): what Synbox does, the three steps in
// order, the questions people ask (one below another, so opening one never leaves a gap beside it), what it's built
// with, the fine print and the links. A window-high box that scrolls under the top bar, as home and the lists do,
// so it gets their scrollbar
const AboutPage = () => {
  const [box, setBox] = useState<HTMLElement | null>(null)
  return (
    <section
      ref={setBox}
      data-scroll-top
      className='relative flex flex-1 flex-col overflow-y-auto pt-(--topbar-h) page-x pb-page-bottom-sm'>
      <title>About · Synbox</title>

      <div className='mx-auto flex w-full max-w-2xl flex-col gap-10 pt-8 sm:pt-12'>
        <header className='flex flex-col gap-3'>
          <h1 className='text-3xl font-bold tracking-tight'>About Synbox</h1>
          <p className='text-lg text-pretty text-muted-foreground'>
            Synbox turns a Japanese song on YouTube into karaoke: timed lyrics
            with furigana, romaji and translations over the original video.
          </p>
        </header>

        <section aria-labelledby='how-it-works' className='flex flex-col gap-4'>
          <h2 id='how-it-works' className={HEADING}>
            How It Works
          </h2>
          <ol className='flex flex-col'>
            {STEPS.map((step, index) => (
              <li key={step.title} className='flex gap-4'>
                {/* The number, and below it the line to the next one, so the steps read as one sequence */}
                <div className='flex flex-col items-center'>
                  <span className='grid size-8 shrink-0 place-items-center rounded-full bg-primary-subtle text-sm font-semibold text-primary-text tabular-nums'>
                    {index + 1}
                  </span>
                  {index < STEPS.length - 1 && (
                    <span aria-hidden className='w-px flex-1 bg-border' />
                  )}
                </div>
                <div
                  className={
                    index < STEPS.length - 1
                      ? 'flex flex-col pb-6'
                      : 'flex flex-col'
                  }>
                  <h3 className='flex min-h-8 items-center font-semibold'>
                    {step.title}
                  </h3>
                  <p className='text-pretty text-muted-foreground'>
                    {step.text}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby='questions' className='flex flex-col gap-4'>
          <h2 id='questions' className={HEADING}>
            Questions
          </h2>
          <Accordion type='multiple' className='w-full'>
            {FAQS.map((faq) => (
              <AccordionItem key={faq.question} value={faq.question}>
                <AccordionTrigger>{faq.question}</AccordionTrigger>
                <AccordionContent>
                  <p className='text-pretty text-muted-foreground'>
                    {faq.answer}
                  </p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        <section aria-labelledby='built-with' className='flex flex-col gap-4'>
          <h2 id='built-with' className={HEADING}>
            Built With
          </h2>
          <dl className='flex flex-col gap-4'>
            {BUILT_WITH.map(({ group, names }) => (
              <div key={group} className='flex flex-col gap-2'>
                <dt className='text-xs font-medium text-muted-foreground'>
                  {group}
                </dt>
                <dd className='flex flex-wrap gap-2'>
                  {names.map((name) => (
                    <span
                      key={name}
                      className='rounded-full bg-card px-3 py-1 text-sm text-muted-foreground'>
                      {name}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <p className='border-t border-border pt-6 text-xs text-pretty text-muted-foreground'>
          A non-commercial personal project with no ads. Songs, videos and
          lyrics belong to their owners and are shown for learning and singing
          along; rights holders can ask for removal through Contact Me below.
        </p>
      </div>

      <SiteLinks />
      <BoxScrollbar box={box} />
    </section>
  )
}

export default AboutPage
