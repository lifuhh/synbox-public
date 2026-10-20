import { handleYoutube } from '../youtube-proxy'

// YOUTUBE_API_KEY is the server-only key. Until it is set, the site's older browser key still serves the
// production site, whose address that key allows (the proxy passes the page's referrer on)
const youtube = async (request: Request) => {
  const serverKey = process.env.YOUTUBE_API_KEY
  return await handleYoutube(
    request,
    serverKey === undefined || serverKey === ''
      ? process.env.VITE_GOOGLE_API_KEY
      : serverKey
  )
}

export default youtube

export const config = { path: '/api/youtube/*' }
