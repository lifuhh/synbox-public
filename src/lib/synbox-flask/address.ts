// The backend runs as two Cloud Run services from one image (synbox-transcribe-whisper › README › Two
// Services, One Image): song generation on the main one, and the quick reads (search, karaoke timing, lyrics
// versions) on a small lookup service, so they never wait behind a song generating. Generation is called through
// the auth Worker (worker/src/generation.ts), which alone may call the main service; locally, the backend itself.
// Without a lookup URL, the main service answers both.
export const BE_ADDRESS = import.meta.env.VITE_SYNBOX_BE_URL
// Whether generation goes through the Worker, which mounts it at /api/generation (worker/src/index.ts). Only the
// Worker keeps guests' free songs; a local backend called directly has no such limit or route
export const VIA_WORKER = /\/api\/generation\/?$/u.test(BE_ADDRESS)
const lookup = import.meta.env.VITE_SYNBOX_LOOKUP_URL ?? ''
export const LOOKUP_ADDRESS = lookup === '' ? BE_ADDRESS : lookup
