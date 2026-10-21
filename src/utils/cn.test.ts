import { expect, test } from 'vite-plus/test'

import { cn } from './cn'

// A theme size cn doesn't know passes for a colour, and the colour after it drops the size: the offline
// reader's Japanese and romaji rendered at 16px in Reader Mode
test('a theme text size survives a text colour after it', () => {
  for (const size of ['text-reader-ja', 'text-reader-romaji', 'text-lyric']) {
    expect(cn(size, 'text-(--reader-accent)').split(' ')).toContain(size)
  }
})
