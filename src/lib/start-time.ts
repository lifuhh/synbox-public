// Where a song's link asks it to start, as YouTube writes it: `?t=250`, `250s`, `4m10s`, `1h2m3s`, or `4:10`.
// Null when there is none or it can't be read, so the song starts from the top
const UNITS =
  /^(?:(?<hours>\d+)h)?(?:(?<minutes>\d+)m)?(?:(?<seconds>\d+(?:\.\d+)?)s?)?$/u
const CLOCK =
  /^(?:(?<hours>\d+):)?(?<minutes>\d{1,2}):(?<seconds>\d{2}(?:\.\d+)?)$/u

export const parseStartTime = (value: string | null): number | null => {
  const text = value?.trim().toLowerCase() ?? ''
  const parts =
    text === '' ? undefined : (CLOCK.exec(text) ?? UNITS.exec(text))?.groups
  if (parts === undefined) {
    return null
  }
  const total =
    Number(parts.hours ?? 0) * 3600 +
    Number(parts.minutes ?? 0) * 60 +
    Number(parts.seconds ?? 0)
  return Number.isFinite(total) && total > 0 ? total : null
}

// The start the page's own link asks for
export const linkStartTime = (): number | null =>
  parseStartTime(new URLSearchParams(window.location.search).get('t'))
