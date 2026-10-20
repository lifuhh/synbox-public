import { handleYoutube } from '../youtube-proxy'

// YOUTUBE_API_KEY is the server-only key. Until it is set, the site's older browser key still serves the
// production site, whose address that key allows (the proxy passes the page's referrer on)
export default async (request: Request) =>
  await handleYoutube(
    request,
    process.env.YOUTUBE_API_KEY || process.env.VITE_GOOGLE_API_KEY
  )

export const config = { path: '/api/youtube/*' }
