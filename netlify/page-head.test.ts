import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vite-plus/test'

import {
  previewFromVideo,
  songHead,
  writeHead,
} from './edge-functions/page-head'

const indexHtml = readFileSync(
  new URL('../index.html', import.meta.url),
  'utf8'
)
const canonical = 'https://synbox.io/v/gcgKUcJKxls'

const count = (html: string, pattern: RegExp) =>
  html.match(new RegExp(pattern, 'gu'))?.length ?? 0

describe('page head', () => {
  it("replaces the home page's head with the song's, once each", () => {
    const song = previewFromVideo({
      items: [
        {
          snippet: {
            channelTitle: 'YOASOBI',
            thumbnails: {
              high: { url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' },
              maxres: { url: 'https://i.ytimg.com/vi/x/maxresdefault.jpg' },
            },
            title: 'YOASOBI「アイドル」 Official Music Video',
          },
        },
      ],
    })
    const html = writeHead(
      indexHtml,
      songHead(canonical, `${canonical}?style=abc`, song)
    )
    expect(html).toContain(
      '<title>YOASOBI「アイドル」 Official Music Video · Synbox Karaoke</title>'
    )
    expect(html).toContain(`<link rel="canonical" href="${canonical}" />`)
    expect(html).toContain(`content="${canonical}?style=abc"`)
    expect(html).toContain(
      '<meta name="description" content="YOASOBI · Karaoke with synced lyrics, furigana, romaji and translations" />'
    )
    expect(html).toContain('maxresdefault.jpg')
    for (const tag of [
      /<title>/,
      /rel="canonical"/,
      /name="description"/,
      /property="og:title"/,
      /property="og:description"/,
      /property="og:url"/,
    ]) {
      expect(count(html, tag)).toBe(1)
    }
    expect(html).not.toContain('Japanese Karaoke for Any YouTube Video</title>')
  })

  it('keeps a hostile title inside its tag', () => {
    const song = previewFromVideo({
      items: [{ snippet: { title: '</title><script>alert(1)</script> $&' } }],
    })
    const html = writeHead(indexHtml, songHead(canonical, canonical, song))
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;')
    expect(html).toContain(' $&amp; · Synbox Karaoke</title>')
  })

  it('keeps a personal page out of search results, with no canonical', () => {
    const html = writeHead(indexHtml, null)
    expect(html).toContain('<meta name="robots" content="noindex" />')
    expect(html).not.toContain('rel="canonical"')
  })

  it('gives up on a video YouTube does not know', () => {
    expect(previewFromVideo({ items: [] })).toBeNull()
  })
})
