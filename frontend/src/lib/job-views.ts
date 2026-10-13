import type { Decision } from '@/api/client'
import type { JobFilter } from '@/api/hooks'

export type JobViewSlug = 'matches' | 'not-matched' | 'undecided' | 'filtered'

export type JobView = {
  slug: JobViewSlug
  label: string
  /** What the backend is asked for. */
  filter: JobFilter
  /** Which Stats counter holds the number of jobs waiting in this view. */
  stat: 'new_matches' | 'new_not_matched' | 'new_undecided' | 'new_filtered'
  empty: { title: string; text: string }
}

function byDecision(decision: Decision): JobFilter {
  return { status: 'new', decision }
}

/** The four views of the Jobs page, in the order of keys 1–4. */
export const JOB_VIEWS: JobView[] = [
  {
    slug: 'matches',
    label: 'Matches',
    filter: byDecision('match'),
    stat: 'new_matches',
    empty: { title: 'No new matches', text: 'Everything is reviewed. Fetch new jobs, or look through the other views.' },
  },
  {
    slug: 'not-matched',
    label: 'Not matched',
    filter: byDecision('no_match'),
    stat: 'new_not_matched',
    empty: { title: 'No rejected jobs', text: 'Jobs the LLM decided against appear here.' },
  },
  {
    slug: 'undecided',
    label: 'Undecided',
    filter: byDecision('undecided'),
    stat: 'new_undecided',
    empty: {
      title: 'Nothing is undecided',
      text: 'Jobs appear here when the LLM was not available or gave no valid answer.',
    },
  },
  {
    slug: 'filtered',
    label: 'Filtered out',
    filter: { status: 'new', filtered: true },
    stat: 'new_filtered',
    empty: { title: 'Nothing was filtered out', text: 'Jobs with an exclude term in the title appear here.' },
  },
]
