// Marks a row that sticks under the top bar (sticky-under-topbar) as stuck or not. A stuck row is see-through: the
// top scrim reaches down past it, by the row's height (--stuck-row-h, read only while a [data-stuck] row is on the
// page, so a row that unmounts stuck leaves nothing behind)
export const markStuck = (row: HTMLElement, stuck: boolean) => {
  if (stuck === Object.hasOwn(row.dataset, 'stuck')) {
    return
  }
  // Written on <html> only when the height changes: every element inherits it, so each write restyles the page
  if (stuck) {
    const height = `${row.offsetHeight}px`
    const root = document.documentElement.style
    if (root.getPropertyValue('--stuck-row-h') !== height) {
      root.setProperty('--stuck-row-h', height)
    }
  }
  row.toggleAttribute('data-stuck', stuck)
}
