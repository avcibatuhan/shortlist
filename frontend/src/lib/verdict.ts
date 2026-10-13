import { effectiveMatch, type Job } from '@/api/client'

export type Tone = 'neutral' | 'match' | 'warn' | 'primary' | 'error'

export type Verdict = 'match' | 'no_match' | 'undecided' | 'filtered'

/** Where a job stands: prefiltered, or by the owner's verdict if given, else the LLM's. */
export function verdictOf(job: Job): Verdict {
  if (job.filter_reason !== null && job.owner_label === null) return 'filtered'
  const match = effectiveMatch(job)
  return match === true ? 'match' : match === false ? 'no_match' : 'undecided'
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  match: 'Match',
  no_match: 'No match',
  undecided: 'Undecided',
  filtered: 'Filtered out',
}

export const VERDICT_TONES: Record<Verdict, Tone> = {
  match: 'match',
  no_match: 'neutral',
  undecided: 'warn',
  filtered: 'neutral',
}
