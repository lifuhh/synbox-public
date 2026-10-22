import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

const AboutPage = () => (
  <section className='relative mt-(--topbar-h) flex-between flex custom-scrollbar max-h-[calc(var(--app-h)-var(--topbar-h))] flex-1 flex-col overflow-y-scroll page-x pb-page-bottom-sm'>
    <title>About | Synbox</title>

    <div className='mx-auto w-full max-w-3xl'>
      <h1 className='my-8 text-center text-3xl font-bold'>About</h1>

      <div className='space-y-6'>
        <p className='text-lg text-pretty'>
          Many Japanese music videos on YouTube lack proper translations or
          romaji, making it difficult for non-Japanese speakers to engage with
          the lyrics. Synbox bridges this gap by offering a customizable overlay
          that displays romaji, translations, and furigana, empowering users to
          enjoy and interact with Japanese lyrics alongside the original music
          video.
        </p>
      </div>

      <h2 className='my-8 text-center text-2xl font-semibold'>FAQs</h2>
      <div className='mb-8'>
        <Accordion type='multiple' className='w-full'>
          <AccordionItem value='item-1'>
            <AccordionTrigger size='lg'>How does Synbox work?</AccordionTrigger>
            <AccordionContent>
              Synbox is your tool to better experience Japanese music. By
              providing a YouTube URL for a Japanese song, you can generate
              English and Chinese translations as well as romaji annotations,
              making all Japanese songs easier to understand and enjoy.
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value='item-2'>
            <AccordionTrigger size='lg'>
              What videos are supported by Synbox?
            </AccordionTrigger>
            <AccordionContent>
              Synbox supports Japanese music videos available on YouTube that
              are between 1 and 8 minutes long.
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value='item-3'>
            <AccordionTrigger size='lg'>
              Why is the transcription quality sometimes poor for a song?
            </AccordionTrigger>
            <AccordionContent>
              Transcription quality can be affected by several factors, such as
              the length of the song’s intro, the audio quality of the video,
              and the song’s tempo. While I strive for accuracy, music videos
              that have Japanese lyrics already uploaded tend to yield the best
              results as AI transcription can be unpredictable.
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value='item-4'>
            <AccordionTrigger size='lg'>
              What’s next for Synbox?
            </AccordionTrigger>
            <AccordionContent>
              <div className='space-y-4'>
                <p>
                  Synbox will be evolving! Here are some features I’m excited to
                  work on in the future:
                </p>

                <div className='space-y-2'>
                  <div className='grid gap-1.5'>
                    <h3 className='font-medium'>Core Features</h3>
                    <ul className='list-disc pl-6'>
                      <li>
                        Incorporating channel-uploaded translations for lyrics
                        display
                      </li>
                      <li>Expanding support for additional languages</li>
                    </ul>
                  </div>

                  <div className='grid gap-1.5'>
                    <h3 className='font-medium'>User Experience</h3>
                    <ul className='list-disc pl-6'>
                      <li>Adding in-site likes and views counters</li>
                      <li>Supporting YouTube playlist imports</li>
                      <li>Introducing automatic re-attempts after errors</li>
                    </ul>
                  </div>

                  <div className='grid gap-1.5'>
                    <h3 className='font-medium'>Technical Improvements</h3>
                    <ul className='list-disc pl-6'>
                      <li>Speeding up processing times</li>
                      <li>Adding batch processing for YouTube playlists</li>
                      <li>
                        Improving error handling with more helpful feedback
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value='item-5'>
            <AccordionTrigger size='lg'>
              What is Synbox built with?
            </AccordionTrigger>
            <AccordionContent>
              <div className='space-y-4'>
                <p>Synbox is a full-stack passion project built with:</p>

                <div className='space-y-2'>
                  <div className='grid gap-1.5'>
                    <h3 className='font-bold'>Frontend</h3>
                    <ul className='list-disc pl-6'>
                      <li>React</li>
                      <li>TypeScript</li>
                      <li>Tailwind CSS</li>
                      <li>ShadCN UI</li>
                    </ul>
                  </div>

                  <div className='grid gap-1.5'>
                    <h3 className='font-bold'>Backend</h3>
                    <ul className='list-disc pl-6'>
                      <li>Python (Flask Framework)</li>
                      <li>Appwrite</li>
                    </ul>
                  </div>

                  <div className='grid gap-1.5'>
                    <h3 className='font-bold'>Infrastructure & APIs</h3>
                    <ul className='list-disc pl-6'>
                      <li>Netlify (Frontend hosting)</li>
                      <li>Google Cloud Run (Backend deployment)</li>
                      <li>Google Data API (YouTube integration)</li>
                      <li>
                        OpenAI API (for transcription, translation, and
                        annotation)
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
      <h2 className='my-8 text-center text-2xl font-semibold'>Disclaimer</h2>
      <p className='pb-2 text-sm'>
        Synbox is a personal project created to help me better understand and
        enjoy Japanese music videos. This is a non-commercial project with no
        monetization, intended solely for personal educational purposes. I
        respect all artists&apos; rights and will promptly remove any content
        upon request from the copyright holders.
      </p>
    </div>

    <nav
      aria-label='Links'
      className='mx-auto flex gap-6 pt-6 text-sm text-muted-foreground'>
      <a
        href='https://github.com/lifuhh/synbox'
        target='_blank'
        rel='noreferrer'
        className='hover:text-foreground'>
        GitHub
      </a>
      <a
        href='https://www.linkedin.com/in/lifuhh/'
        target='_blank'
        rel='noreferrer'
        className='hover:text-foreground'>
        LinkedIn
      </a>
    </nav>
  </section>
)

export default AboutPage
