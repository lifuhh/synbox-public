import { handleYoutube } from '../youtube-proxy'

export default async (request: Request) =>
  await handleYoutube(request, process.env.YOUTUBE_API_KEY)

export const config = { path: '/api/youtube/*' }
