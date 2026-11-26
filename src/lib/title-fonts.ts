import { useEffect } from 'react'

import { firstScreenIn } from '@/lib/first-screen'

// The web fonts come a slice of characters at a time (unicode-range), each loaded when a character from it first
// shows. A list draws only the rows near its view, so the titles' slices arrived mid-scroll, and in WebKit each slice
// that arrives restyles and lays out the whole page (about 95ms on Home), a stall per slice. Asked for together, they
// cost one such pause, at rest. One family at a time: given the whole stack, WebKit loads a character's slice only
// from the first family whose range lists it, so a symbol Plus Jakarta Sans's range lists but the font doesn't draw
// still brought Noto Sans JP's Latin slice in mid-scroll
const loadFonts = (text: string) => {
  for (const family of getComputedStyle(document.body).fontFamily.split(',')) {
    void document.fonts.load(`600 1rem ${family.trim()}`, text)
  }
}

// Data Saver is on: the batch is skipped, and titles load their slices as they show
const savesData = () =>
  'connection' in navigator &&
  typeof navigator.connection === 'object' &&
  navigator.connection !== null &&
  'saveData' in navigator.connection &&
  navigator.connection.saveData === true

// Loads the fonts for a list's titles ahead of its scroll. After the first screen is in, as the pages' prefetch
// (src/app.tsx): Home's batch is about 70 files and 2 MB, and asked for any sooner it competed with the first
// screen's lists and pictures
export const useTitleFonts = (text: string) => {
  useEffect(() => {
    let left = false
    if (text !== '' && !savesData()) {
      void (async () => {
        await firstScreenIn()
        if (!left) {
          loadFonts(text)
        }
      })()
    }
    return () => {
      left = true
    }
  }, [text])
}
