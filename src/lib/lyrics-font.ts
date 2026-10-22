// Google Fonts splits Noto Sans JP into ~120 unicode-range slices and fetches
// a slice the first time a glyph from it is drawn. Until it arrives the kanji
// paints in the fallback font (font-display: swap), then jumps to ours.
// Fetching every slice the song's text touches before it plays avoids that.
// The Chinese translation's characters come from Noto Sans SC the same way
export const loadLyricsFont = async (text: string, chinese: string) => {
  await Promise.all([
    document.fonts.load("900 1em 'Noto Sans JP'", text),
    chinese === ''
      ? null
      : document.fonts.load("900 1em 'Noto Sans SC'", chinese),
  ])
}
