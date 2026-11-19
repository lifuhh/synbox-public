import { StatusPage } from '@/components/shared/status-page'

// An address that is no page of the app (a mistyped or outdated link). It says so and offers the way on, instead of
// opening Home under an address that doesn't match it. Most stray links are a song's, so the line points at the
// search field, which takes a YouTube link. `noindex`: the host answers every app address with the shell and a 200,
// so a search engine is told here not to keep it
const NotFound = () => (
  <StatusPage
    title='Page Not Found'
    line='Paste a YouTube link in Search to make it karaoke'>
    <title>Page Not Found · Synbox</title>
    <meta name='robots' content='noindex' />
  </StatusPage>
)

export default NotFound
