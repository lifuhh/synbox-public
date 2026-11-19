const KATAKANA = /[ァ-ヶ]/gu

// Width, case and kana read alike: "ｶﾗｵｹ", "カラオケ" and "からおけ" are one word, "ＹＯＡＳＯＢＩ" is "yoasobi".
// Punctuation stays, so an email or a video id is found as typed
export const fold = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(KATAKANA, (char) =>
      String.fromCodePoint((char.codePointAt(0) ?? 0) - 0x60)
    )

// A search over a list already loaded: every word typed is somewhere in the row's fields, in any order. An empty
// query matches every row
export const matchesQuery = (
  query: string,
  fields: readonly (string | null | undefined)[]
) => {
  const words = fold(query).split(/\s+/u).filter(Boolean)
  if (words.length === 0) {
    return true
  }
  const text = fold(fields.filter(Boolean).join('\n'))
  return words.every((word) => text.includes(word))
}
