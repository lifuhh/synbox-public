import { handleYoutube } from '../youtube-proxy'

// YOUTUBE_API_KEY is a server-only key: it never reaches the browser bundle
const youtube = async (request: Request) =>
  await handleYoutube(request, process.env.YOUTUBE_API_KEY)

export default youtube

export const config = { path: '/api/youtube/*' }
