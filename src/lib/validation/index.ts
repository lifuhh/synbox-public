import { z } from 'zod'

const YouTubeUrlOrIdRegex =
  /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=)?[\w-]{11}(?:\S+)?$|^[\w-]{11}$/u

export const YouTubeUrlOrIdValidation = z
  .string()
  .trim()
  .regex(YouTubeUrlOrIdRegex, {
    message: 'Invalid YouTube URL or video ID',
  })
