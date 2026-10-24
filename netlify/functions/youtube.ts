import { handleYoutube } from '../youtube-proxy'

// YOUTUBE_API_KEY is a server-only key: it never reaches the browser bundle
const youtube = async (request: Request) =>
  await handleYoutube(request, process.env.YOUTUBE_API_KEY)

export default youtube

// Netlify answers past this many requests a minute from one address with 429 (a code-based rule: every plan
// allows two). A home visit asks for the chart's two pages, a player visit for one video
export const config = {
  path: '/api/youtube/*',
  rateLimit: { aggregateBy: ['ip', 'domain'], windowLimit: 30, windowSize: 60 },
}
