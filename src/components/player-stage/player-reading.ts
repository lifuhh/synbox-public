export interface PlayerReading {
  time: number
  duration: number
}

export const NO_READING: PlayerReading = { duration: 0, time: 0 }

// YouTube answers a duration of 0 (or NaN) while a song is being cued or a player rebuilt, and no player
// answers at all in between. The stage keeps the last real reading until a real one comes, so the seek bar
// never measures the old time against a zero-length song and parks its thumb at the end
export const holdReading = (
  held: PlayerReading,
  reported: PlayerReading | null
): PlayerReading => {
  if (reported === null) {
    return held
  }
  const duration =
    Number.isFinite(reported.duration) && reported.duration > 0
      ? reported.duration
      : held.duration
  const time =
    Number.isFinite(reported.time) && reported.time >= 0
      ? reported.time
      : held.time
  return time === held.time && duration === held.duration
    ? held
    : { duration, time }
}
