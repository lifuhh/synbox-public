// What a guest's device looks like to every browser on it, sent with a guest's generation calls so a private
// window or a second browser is the same guest (worker/src/guest-song.ts, which keeps only a hash of it): the system
// family (never the browser), the screen in device pixels (unchanged by zoom), the pixel ratio, the cores and the
// time zone. No canvas, fonts or anything else that singles a device out
const osFamily = (agent: string) => {
  if (/iPhone|iPad|iPod/u.test(agent)) {
    return 'ios'
  }
  if (/Android/u.test(agent)) {
    return 'android'
  }
  if (/CrOS/u.test(agent)) {
    return 'chromeos'
  }
  if (/Mac OS X|Macintosh/u.test(agent)) {
    // iPadOS asks for desktop pages as a Mac; a touch screen gives it away
    return globalThis.navigator?.maxTouchPoints > 1 ? 'ios' : 'macos'
  }
  if (/Windows/u.test(agent)) {
    return 'windows'
  }
  return /Linux/u.test(agent) ? 'linux' : 'other'
}

// Outside a browser (tests) a trait it can't read is 0
export const deviceTraits = () => {
  const ratio = globalThis.devicePixelRatio || 1
  const sides =
    typeof screen === 'undefined' ? [0, 0] : [screen.width, screen.height]
  const [short, long] = sides
    .map((side) => Math.round(side * ratio))
    .toSorted((a, b) => a - b)
  return [
    `os=${osFamily(globalThis.navigator?.userAgent ?? '')}`,
    `screen=${short}x${long}`,
    `dpr=${Math.max(1, Math.round(ratio))}`,
    `cores=${globalThis.navigator?.hardwareConcurrency || 0}`,
    `tz=${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
  ].join('; ')
}

export const DEVICE_HEADER = 'X-Synbox-Device'
