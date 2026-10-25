// Where a song's link asks it to start, as YouTube writes it: `?t=250`, `250s`, `4m10s`, `1h2m3s`, or `4:10`.
// Null when there is none or it can't be read, so the song starts from the top
const UNITS = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s?)?$/u
const CLOCK = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/u

export const parseStartTime = (value: string | null): number | null => {
  const text = value?.trim().toLowerCase() ?? ''
  if (text === '') {
    return null
  }
  const clock = CLOCK.exec(text)
  const units = clock === null ? UNITS.exec(text) : null
  const [hours, minutes, seconds] = (clock ?? units)?.slice(1) ?? []
  if (clock === null && units === null) {
    return null
  }
  const total =
    Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)
  return Number.isFinite(total) && total > 0 ? total : null
}

// The start the page's own link asks for
export const linkStartTime = (): number | null =>
  parseStartTime(new URLSearchParams(window.location.search).get('t'))
