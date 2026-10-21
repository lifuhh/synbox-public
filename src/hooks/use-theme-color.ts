import type { RefObject } from 'react'
import { useEffect } from 'react'

// Android paints the installed app's status bar (and Chrome its toolbar) in the theme colour. While a surface with
// its own top colour is up, the bar takes that surface's --theme-color, so the stylesheet stays its one source.
// It is read again when the surface switches theme (data-theme)
export const useThemeColor = (surface: RefObject<HTMLElement | null>) => {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]'
    )
    const element = surface.current
    const follow = (tag: HTMLMetaElement, from: HTMLElement) => {
      const previous = tag.content
      const apply = () => {
        const color = getComputedStyle(from)
          .getPropertyValue('--theme-color')
          .trim()
        tag.content = color === '' ? previous : color
      }
      apply()
      const observer = new MutationObserver(apply)
      observer.observe(from, {
        attributeFilter: ['data-theme'],
        attributes: true,
      })
      return () => {
        observer.disconnect()
        tag.content = previous
      }
    }
    return meta && element ? follow(meta, element) : undefined
  }, [surface])
}
