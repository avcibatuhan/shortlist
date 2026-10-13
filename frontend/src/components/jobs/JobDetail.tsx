import type { ReactNode } from 'react'
import type { Job } from '@/api/client'
import { SourceLink } from '@/components/Chip'
import { formatRelativeDay } from '@/lib/format'
import { REMOTE_LABELS } from '@/lib/jobs'

const LANGUAGES: Record<string, string> = { de: 'German', en: 'English' }

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <dt className="label-mono">{label}</dt>
      <dd className={`mt-1 text-sm font-medium ${tone ?? ''}`}>{value}</dd>
    </div>
  )
}

/** Meta line, title and links of a job. */
export function JobHeader({ job, children }: { job: Job; children?: ReactNode }) {
  const meta = [
    job.company,
    job.location,
    job.posted_at ? `posted ${formatRelativeDay(job.posted_at)}` : null,
  ].filter(Boolean)
  return (
    <header className="shrink-0 space-y-4 border-b bg-background p-6 pb-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted-foreground">
            {meta.map((item) => (
              <span key={item} className="after:ml-2 after:content-['•']">
                {item}
              </span>
            ))}
            <span className="rounded-sm border bg-surface-high px-1 text-[10px] uppercase">{job.language}</span>
            {job.description_is_snippet ? <span className="italic">• snippet only</span> : null}
          </p>
          <h1 className="text-2xl leading-8 font-semibold tracking-tight">{job.title}</h1>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {job.sources.map((source) => (
            <SourceLink key={`${source.source}:${source.url}`} source={source} />
          ))}
        </div>
      </div>
      {children}
    </header>
  )
}

/** The known facts of a job and its full description, as plain text. */
export function JobBody({ job }: { job: Job }) {
  const facts = [
    job.remote !== 'unknown' ? { label: 'Workplace', value: REMOTE_LABELS[job.remote] } : null,
    job.employment_type ? { label: 'Type', value: job.employment_type } : null,
    job.salary_text ? { label: 'Salary', value: job.salary_text, tone: 'text-match font-mono' } : null,
    { label: 'Posting language', value: LANGUAGES[job.language] ?? 'Other' },
  ].filter((fact) => fact !== null)
  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {facts.map((fact) => (
          <Fact key={fact.label} {...fact} />
        ))}
      </dl>
      <section aria-label="Description" className="max-w-[75ch] space-y-2">
        <h2 className="border-b pb-2 text-base font-semibold">Description</h2>
        {job.description ? (
          <p className="text-[15px] leading-7 whitespace-pre-line">{job.description}</p>
        ) : (
          <p className="text-sm text-muted-foreground">The source gave no description.</p>
        )}
        {job.description_is_snippet ? (
          <p className="font-mono text-[11px] text-muted-foreground">
            Snippet only — this source does not provide the full text. Open the ad to read the rest.
          </p>
        ) : null}
      </section>
    </div>
  )
}
