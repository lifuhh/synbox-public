// "/" puts the cursor in the search field, as on YouTube, GitHub and most sites with one. The fields mark
// themselves with data-search-key (Home's, the Search page's, the top bar's); the first one on screen takes it,
// so the page's own field wins over the bar's while it shows. Not while typing, nor with a modifier held
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

const onScreen = (field: HTMLElement) => {
  // The top bar keeps its field in place, faded out and inert, while Home's own field shows
  if (
    !field.checkVisibility({
      opacityProperty: true,
      visibilityProperty: true,
    }) ||
    field.closest('[inert]') !== null
  ) {
    return false
  }
  const box = field.getBoundingClientRect()
  return box.bottom > 0 && box.top < window.innerHeight
}

const onKeyDown = (event: KeyboardEvent) => {
  if (
    event.key !== '/' ||
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    isTyping(event.target)
  ) {
    return
  }
  const field = [
    ...document.querySelectorAll<HTMLInputElement>('[data-search-key]'),
  ].find(onScreen)
  if (field === undefined) {
    return
  }
  // Or the slash is typed into the field it just focused
  event.preventDefault()
  field.focus()
  field.select()
}

export const listenForSearchKey = () => {
  document.addEventListener('keydown', onKeyDown)
  return () => {
    document.removeEventListener('keydown', onKeyDown)
  }
}
