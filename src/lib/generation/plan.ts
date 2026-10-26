// The stages the backend streams as {type: 'progress', data: {stage, ...}}, in the order they run
// (synbox-transcribe-whisper › services/progress.py). `weight` is the stage's usual seconds for a
// four-minute song; it sets the stage's share of the overall percentage, fixed for the whole job so the
// overall bar can never move backwards.
export const STAGES = [
  {
    id: 'check',
    label: 'Checking the video',
    phase: 'validate',
    weight: 5,
  },
  {
    id: 'download',
    label: 'Preparing the song',
    phase: 'validate',
    weight: 10,
  },
  {
    id: 'read',
    label: 'Reading subtitles and song details',
    phase: 'transcribe',
    weight: 8,
  },
  {
    id: 'separate',
    label: 'Analyzing the vocals',
    phase: 'transcribe',
    weight: 90,
  },
  {
    id: 'listen',
    label: 'Listening to the vocals',
    phase: 'transcribe',
    weight: 30,
  },
  {
    id: 'lyrics',
    label: 'Finding the lyrics',
    phase: 'transcribe',
    weight: 20,
  },
  {
    id: 'align',
    label: 'Timing every syllable',
    phase: 'transcribe',
    weight: 45,
  },
  {
    id: 'verify',
    label: 'Checking the timing',
    phase: 'transcribe',
    weight: 10,
  },
  {
    id: 'translate',
    label: 'Translating the whole song',
    phase: 'translate',
    weight: 45,
  },
  { id: 'save', label: 'Saving the song', phase: 'translate', weight: 4 },
] as const

export type StageId = (typeof STAGES)[number]['id']
export type Phase = (typeof STAGES)[number]['phase']

export const stageIndex = (id: StageId) =>
  STAGES.findIndex((stage) => stage.id === id)

export const isStageId = (value: unknown): value is StageId =>
  STAGES.some((stage) => stage.id === value)

// What the panel lists: one row and one bar per step. The first is the quick check, so the panel shows a
// step clearing within seconds instead of one long first step
export const STEPS = [
  { id: 'check', stages: ['check'], title: 'Song Check' },
  { id: 'fetch', stages: ['download', 'read'], title: 'Song Analysis' },
  { id: 'vocals', stages: ['separate'], title: 'Vocal Analysis' },
  { id: 'transcribe', stages: ['listen', 'lyrics'], title: 'Transcription' },
  { id: 'sync', stages: ['align', 'verify'], title: 'Timing Sync' },
  { id: 'translate', stages: ['translate', 'save'], title: 'Translation' },
] as const satisfies readonly {
  id: string
  title: string
  stages: readonly StageId[]
}[]

export type Step = (typeof STEPS)[number]

// The step a stage belongs to
export const stepOf = (id: StageId) =>
  STEPS.find((step) => (step.stages as readonly StageId[]).includes(id))

// How far through the whole job a report of `fraction` into stage `id` is, by the panel's own weights
export const overallAt = (id: StageId, fraction: number) => {
  const at = stageIndex(id)
  let total = 0
  let done = 0
  for (const [index, stage] of STAGES.entries()) {
    total += stage.weight
    if (index < at) {
      done += stage.weight
    } else if (index === at) {
      done += stage.weight * fraction
    }
  }
  return done / total
}
