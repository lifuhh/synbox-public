// Marks a row that sticks under the top bar (sticky-under-topbar) as stuck or not. A stuck row is see-through: the
// top scrim reaches down past it, by the row's height (--stuck-row-h, read only while a [data-stuck] row is on the
// page, so a row that unmounts stuck leaves nothing behind)
export const markStuck = (row: HTMLElement, stuck: boolean) => {
  if (stuck === Object.hasOwn(row.dataset, 'stuck')) {
    return
  }
  // Written on the top scrim (root-layout.tsx), its only reader. On <html> every element inherited it, and the first
  // stick restyled the whole page in the scroll: about 50ms in WebKit on Home
  const scrim = document.querySelector<HTMLElement>('[data-status-scrim]')
  if (stuck && scrim !== null) {
    const height = `${row.offsetHeight}px`
    if (scrim.style.getPropertyValue('--stuck-row-h') !== height) {
      scrim.style.setProperty('--stuck-row-h', height)
    }
  }
  row.toggleAttribute('data-stuck', stuck)
}
