import { z } from 'zod'

// The lyrics row as Appwrite stores it: every field is a JSON array in a string, index-aligned by line
const lyricLineSchema = z.object({
  endSeconds: z.number(),
  startSeconds: z.number(),
  text: z.string(),
})
const lyricsDocumentSchema = z.object({
  chi_translation: z.string(),
  eng_translation: z.string(),
  labelled_full_lyrics: z.string(),
  romaji: z.string(),
})

const parseJsonWith = <T>(schema: z.ZodType<T>, raw: string): T | null => {
  try {
    const result = schema.safeParse(JSON.parse(raw))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export interface TimedLyrics {
  lines: z.infer<typeof lyricLineSchema>[]
  eng: string[]
  chi: string[]
  romaji: string[]
}

export const parseLyricsDocument = (data: unknown): TimedLyrics | null => {
  const document = lyricsDocumentSchema.safeParse(data)
  if (!document.success) {
    return null
  }
  const texts = z.array(z.string())
  const lines = parseJsonWith(
    z.array(lyricLineSchema),
    document.data.labelled_full_lyrics
  )
  const eng = parseJsonWith(texts, document.data.eng_translation)
  const chi = parseJsonWith(texts, document.data.chi_translation)
  const romaji = parseJsonWith(texts, document.data.romaji)
  if (!(lines && eng && chi && romaji)) {
    return null
  }
  return { chi, eng, lines, romaji }
}
