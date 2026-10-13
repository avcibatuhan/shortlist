import createClient from 'openapi-fetch'
import type { components, paths } from './schema'

export const api = createClient<paths>({
  baseUrl: window.location.origin,
  // Look up fetch per request so tests can stub it.
  fetch: (request) => globalThis.fetch(request),
})

type Schemas = components['schemas']
export type Health = Schemas['HealthResponse']
export type Job = Schemas['JobOut']
export type JobSource = Schemas['JobSourceOut']
export type Run = Schemas['RunOut']
export type RunProgress = Schemas['RunProgress']
export type SourceProgress = Schemas['SourceProgress']
export type SourceStats = Schemas['SourceStats']
export type Source = Schemas['SourceOut']
export type Estimate = Schemas['EstimateOut']
export type MonthCost = Schemas['MonthCost']
export type MatchStatus = Schemas['MatchStatus']
export type Settings = Schemas['SettingsOut']
export type SettingsBody = Schemas['SettingsBody']
export type Search = Schemas['Search']
export type Stats = Schemas['Stats']
export type Models = Schemas['Models']
export type CoverLetter = Schemas['CoverLetterOut']
export type JobUpdate = Schemas['JobUpdate']
export type ModelTest = Schemas['ModelTest']
export type Decision = NonNullable<NonNullable<paths['/api/jobs']['get']['parameters']['query']>['decision']>
export type SourceName = JobSource['source']
export type Limits = Partial<Record<SourceName, number>>

/** The verdict that decides where a job is listed: the owner's if given, else the LLM's. */
export function effectiveMatch(job: Job): boolean | null {
  return job.owner_label ?? job.match
}

/**
 * Message for a failed request: FastAPI's `detail` (a string, or the list of validation
 * problems), else the fallback.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null || !('detail' in error)) return fallback
  const { detail } = error
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const problems = detail.flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null || !('msg' in item)) return []
      const where = 'loc' in item && Array.isArray(item.loc) ? item.loc.slice(1).join(' › ') : ''
      return [`${where ? `${where}: ` : ''}${String(item.msg)}`]
    })
    if (problems.length > 0) return problems.join('; ')
  }
  return fallback
}
