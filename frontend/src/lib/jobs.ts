import type { Job } from '@/api/client'

/** Open every source link of a job, each in its own tab. */
export function openJob(job: Job) {
  for (const source of job.sources) window.open(source.url, '_blank', 'noopener,noreferrer')
}

export const REMOTE_LABELS: Record<Exclude<Job['remote'], 'unknown'>, string> = {
  onsite: 'On-site',
  hybrid: 'Hybrid',
  remote: 'Remote',
}
