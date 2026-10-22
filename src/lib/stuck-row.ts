// Marks a row that sticks under the top bar (sticky-under-topbar) as stuck or not. A stuck row is see-through: the
// top scrim reaches down past it, by the row's height (--stuck-row-h, read only while a [data-stuck] row is on the
// page, so a row that unmounts stuck leaves nothing behind)
export const markStuck = (row: HTMLElement, stuck: boolean) => {
  if (stuck === Object.hasOwn(row.dataset, 'stuck')) {
    return
  }
  if (stuck) {
    document.documentElement.style.setProperty(
      '--stuck-row-h',
      `${row.offsetHeight}px`
    )
  }
  row.toggleAttribute('data-stuck', stuck)
}
