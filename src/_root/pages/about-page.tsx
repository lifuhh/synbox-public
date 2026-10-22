import { Link } from 'react-router'

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
    text: 'The vocals are separated and transcribed, then matched to the published lyrics where they exist.',
    title: 'Lyrics Are Built',
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

const BUILT_WITH = [
  'React',
  'TypeScript',
  'Vite',
  'Tailwind CSS',
  'Radix UI',
  'TanStack Query',
  'Jotai',
  'Cloudflare Workers',
  'Better Auth',
  'Netlify',
  'Python',
  'Flask',
  'Google Cloud Run',
  'Appwrite',
  'ElevenLabs Scribe',
  'OpenAI',
  'pyopenjtalk',
]

// One screen on a desktop: what Synbox does, how, the questions people ask, and the fine print
const AboutPage = () => (
  <section className='relative mt-(--topbar-h) flex custom-scrollbar max-h-[calc(var(--app-h)-var(--topbar-h))] flex-1 flex-col overflow-y-auto page-x pb-page-bottom-sm'>
    <title>About | Synbox</title>

    <div className='mx-auto flex w-full max-w-3xl flex-col gap-8 pt-8'>
      <header className='flex flex-col gap-3 text-center'>
        <h1 className='text-3xl font-bold'>About</h1>
        <p className='text-lg text-pretty text-muted-foreground'>
          Synbox turns a Japanese song on YouTube into karaoke: timed lyrics
          with furigana, romaji and translations over the original video.
        </p>
      </header>

      <ol className='grid gap-3 sm:grid-cols-3'>
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className='flex flex-col gap-1 rounded-xl bg-card p-4'>
            <span className='text-sm font-semibold text-primary-text tabular-nums'>
              {index + 1}
            </span>
            <h2 className='font-semibold'>{step.title}</h2>
            <p className='text-sm text-pretty text-muted-foreground'>
              {step.text}
            </p>
          </li>
        ))}
      </ol>

      <Accordion type='multiple' className='w-full'>
        {FAQS.map((faq) => (
          <AccordionItem key={faq.question} value={faq.question}>
            <AccordionTrigger>{faq.question}</AccordionTrigger>
            <AccordionContent>{faq.answer}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      <section aria-labelledby='built-with' className='flex flex-col gap-3'>
        <h2 id='built-with' className='text-sm font-semibold'>
          Built With
        </h2>
        <ul className='flex flex-wrap gap-1.5'>
          {BUILT_WITH.map((name) => (
            <li
              key={name}
              className='rounded-full bg-card px-2.5 py-1 text-xs text-muted-foreground'>
              {name}
            </li>
          ))}
        </ul>
      </section>

      <p className='text-xs text-pretty text-muted-foreground'>
        A non-commercial personal project with no ads. Songs, videos and lyrics
        belong to their owners and are shown for learning and singing along;
        rights holders can ask for removal through the link below.
      </p>
    </div>

    <nav
      aria-label='Links'
      className='mx-auto flex gap-6 pt-4 text-sm text-muted-foreground'>
      <a
        href='https://www.linkedin.com/in/lifuhh/'
        target='_blank'
        rel='noreferrer'
        className='hover:text-foreground'>
        LinkedIn
      </a>
      <Link to='/privacy' className='hover:text-foreground'>
        Privacy
      </Link>
    </nav>
  </section>
)

export default AboutPage
