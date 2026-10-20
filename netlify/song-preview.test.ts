import { describe, expect, it } from 'vite-plus/test'

import { injectPreview, previewFromVideo } from './edge-functions/song-preview'

const page = '<html><head><title>Synbox</title></head><body></body></html>'
const url = 'https://synbox.io/v/gcgKUcJKxls'

describe('song preview', () => {
  it('describes the song with its title, channel and largest thumbnail', () => {
    const song = previewFromVideo(
      {
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
      },
      url
    )
    if (song === null) {
      throw new Error('expected a preview')
    }
    const html = injectPreview(page, song)
    expect(html).toContain(
      '<meta property="og:title" content="YOASOBI「アイドル」 Official Music Video" />'
    )
    expect(html).toContain(
      'content="YOASOBI · Karaoke with synced lyrics, furigana, romaji and translations"'
    )
    expect(html).toContain('maxresdefault.jpg')
    expect(html).toMatch(/<\/head><body>/u)
  })

  it('keeps a hostile title inside its attribute', () => {
    const song = previewFromVideo(
      { items: [{ snippet: { title: '"><script>alert(1)</script>' } }] },
      url
    )
    if (song === null) {
      throw new Error('expected a preview')
    }
    const html = injectPreview(page, song)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&quot;&gt;&lt;script&gt;')
  })

  it('gives up on a video YouTube does not know', () => {
    expect(previewFromVideo({ items: [] }, url)).toBeNull()
  })
})
