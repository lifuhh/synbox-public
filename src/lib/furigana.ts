// One furigana shape for every lyric source. It matches the backend's
// Seg{base, rt} (karaoke.json tokens[].ruby); rt is '' for kana and Latin text.
export interface RubySegment {
  base: string
  rt: string
}

const KANJI_READING = /(?<base>[一-龯々]+)\[(?<rt>[^\]]+)\]/gu
const STRAY_BRACKETS = /\[[^\]]*\]/gu

const pushText = (segments: RubySegment[], text: string) => {
  if (!text) {
    return
  }
  const [last] = segments.slice(-1)
  if (last !== undefined && last.rt === '') {
    last.base += text
    return
  }
  segments.push({ base: text, rt: '' })
}

// Bracket format shared with the backend and karaoke.json lines[].furigana:
// 輝[かがや]く. Same rules as the backend's convert_to_ruby (services/lyrics/doc.py).
export const parseFurigana = (annotated: string): RubySegment[] => {
  const segments: RubySegment[] = []
  let cursor = 0
  for (const match of annotated.matchAll(KANJI_READING)) {
    pushText(
      segments,
      annotated.slice(cursor, match.index).replace(STRAY_BRACKETS, '')
    )
    segments.push({
      base: match.groups?.base ?? '',
      rt: match.groups?.rt ?? '',
    })
    cursor = match.index + match[0].length
  }
  pushText(segments, annotated.slice(cursor).replace(STRAY_BRACKETS, ''))
  return segments
}

const collectSegments = (node: Node, segments: RubySegment[]) => {
  if (node.nodeType === Node.TEXT_NODE) {
    pushText(segments, node.textContent ?? '')
    return
  }
  if (node.nodeName !== 'RUBY') {
    for (const child of node.childNodes) {
      collectSegments(child, segments)
    }
    return
  }
  let base = ''
  let rt = ''
  for (const child of node.childNodes) {
    if (child.nodeName === 'RT') {
      rt += child.textContent ?? ''
    } else if (child.nodeName !== 'RP') {
      base += child.textContent ?? ''
    }
  }
  if (rt) {
    segments.push({ base, rt })
  } else {
    pushText(segments, base)
  }
}

// Stored HTML lines (labelled_full_lyrics): <ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>.
// DOMParser documents never run scripts, and React escapes the text it renders.
export const parseRubyHtml = (html: string): RubySegment[] => {
  const segments: RubySegment[] = []
  collectSegments(
    new DOMParser().parseFromString(html, 'text/html').body,
    segments
  )
  return segments
}
