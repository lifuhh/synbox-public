import { handleYoutube } from '../youtube-proxy'

// YOUTUBE_API_KEY is a server-only key: it never reaches the browser bundle
const youtube = async (request: Request) =>
  await handleYoutube(request, process.env.YOUTUBE_API_KEY)

export default youtube

// Netlify answers past this many requests a minute from one address with 429 (a code-based rule: every plan
// allows two). It counts the requests the CDN answers too (rate limiting runs before the edge cache), and a
// phone carrier puts many people behind one address, so the limit is set for a crowd: a home visit asks for the
// chart's two pages, a player visit for one video. Each new video id is a quota read the cache can't absorb;
// this caps one address at 300 a minute, it does not guard the daily quota
export const config = {
  path: '/api/youtube/*',
  rateLimit: {
    aggregateBy: ['ip', 'domain'],
    windowLimit: 300,
    windowSize: 60,
  },
}
