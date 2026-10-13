import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import App from '@/App'
import type {
  Estimate,
  Health,
  Job,
  MatchStatus,
  Models,
  Run,
  RunProgress,
  Settings,
  Source,
  SourceStats,
  Stats,
} from '@/api/client'

export const HEALTHY: Health = { status: 'ok', database: 'ok', schema_revision: '0002', detail: null }

const SEARCH = { keyword: 'softwareentwickler', location: 'deutschland', posted_within_days: 1 }
export const SOURCES: Source[] = [
  { name: 'linkedin', default_limit: 5, searches: [{ ...SEARCH, keyword: 'software developer' }] },
  { name: 'indeed', default_limit: 5, searches: [SEARCH] },
  { name: 'stepstone', default_limit: 5, searches: [SEARCH] },
]

export const ESTIMATE: Estimate = {
  sources: { linkedin: 0.01, indeed: 0.004, stepstone: 0.02 },
  max_cost_usd: 0.034,
  month_spent_usd: 0.12,
  monthly_budget_usd: 10,
  exceeds_budget: false,
}

export const MATCH_IDLE: MatchStatus = {
  running: false,
  done: 0,
  total: 0,
  matched: 0,
  not_matched: 0,
  undecided: 0,
  error: null,
  undecided_jobs: 0,
}

export const SETTINGS: Settings = {
  full_name: '',
  profile_text: '- .NET developer, 3 years',
  searches: {
    linkedin: [{ keyword: '.NET developer', location: 'Germany', posted_within_days: 1 }],
    indeed: [{ keyword: '.net entwickler', location: null, posted_within_days: 1 }],
    stepstone: [
      { keyword: '.net entwickler', location: 'deutschland', posted_within_days: 1 },
      { keyword: 'softwareentwickler', location: 'deutschland', posted_within_days: null },
    ],
  },
  default_limits: { linkedin: 5, indeed: 5, stepstone: 5 },
  exclude_terms: ['Werkstudent', 'Praktikum'],
  monthly_budget_usd: 10,
  prices: {
    linkedin: { per_1000_results: 2, per_start: 0.00005 },
    indeed: { per_1000_results: 0.1, per_start: 0.001 },
    stepstone: { per_1000_results: 1, per_start: 0.005 },
  },
  model_name: 'qwen3.5:9b',
  ollama_url: 'http://127.0.0.1:11434',
  apify_token_configured: true,
}

export const MODELS: Models = {
  current: 'gemma4:12b-it-qat',
  installed: ['gemma4:12b-it-qat', 'qwen3.5:9b'],
  error: null,
}

export const STATS: Stats = {
  applied_this_week: 0,
  interviews_total: 0,
  new_matches: 0,
  new_not_matched: 0,
  new_undecided: 0,
  new_filtered: 0,
  saved: 0,
  labelled: 0,
  labelled_relevant: 0,
  labelled_not_relevant: 0,
}

type Reply = { status?: number; body: unknown }
type Handler = Reply | ((request: Request) => Reply | Promise<Reply>)

/**
 * Stub the backend. Keys are "METHOD /path" (query string ignored). Unlisted requests answer
 * like a healthy backend without runs or jobs; anything else unlisted fails the test.
 */
export function stubApi(routes: Record<string, Handler> = {}) {
  const defaults: Record<string, Handler> = {
    'GET /api/health': { body: HEALTHY },
    'GET /api/sources': { body: SOURCES },
    'POST /api/runs/estimate': { body: ESTIMATE },
    'GET /api/runs': { body: [] },
    'GET /api/runs/costs': { body: [] },
    'GET /api/jobs': { body: [] },
    'GET /api/match/status': { body: MATCH_IDLE },
    'GET /api/settings': { body: SETTINGS },
    'GET /api/settings/models': { body: MODELS },
    'GET /api/stats': { body: STATS },
  }
  const fetchMock = vi.fn(async (request: Request) => {
    const key = `${request.method} ${new URL(request.url).pathname}`
    const handler = routes[key] ?? defaults[key]
    if (handler === undefined) throw new Error(`Unexpected request: ${key}`)
    const { status = 200, body } = typeof handler === 'function' ? await handler(request) : handler
    return Response.json(body, { status })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Requests the app made to one endpoint, e.g. requestsTo(fetchMock, 'POST', '/api/runs'). */
export function requestsTo(fetchMock: ReturnType<typeof stubApi>, method: string, path: string): Request[] {
  return fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path)
}

/** Stand-in for the browser's EventSource; tests push progress with `emit`. */
export class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  close() {
    this.closed = true
  }

  emit(progress: Pick<RunProgress, 'run_id' | 'stage'> & Partial<RunProgress>) {
    const full: RunProgress = { sources: {}, llm_done: 0, llm_total: 0, ...progress }
    act(() => this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(full) })))
  }
}

export function stubEventSource() {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
}

export function renderApp(path = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

export function makeStats(overrides: Partial<SourceStats> = {}): SourceStats {
  return { limit: 5, fetched: 5, skipped: 0, duplicates: 0, known: 0, new: 5, starts: 3, cost_usd: 0.02, ...overrides }
}

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 1,
    started_at: '2026-10-13T08:00:00Z',
    finished_at: '2026-10-13T08:01:00Z',
    state: 'done',
    limits: { stepstone: 5 },
    fetched: 5,
    skipped: 0,
    duplicates_in_run: 0,
    already_known: 2,
    new: 3,
    prefiltered_out: 0,
    matched: 0,
    not_matched: 0,
    undecided: 0,
    estimated_cost_usd: 0.02,
    sources: { stepstone: makeStats({ known: 2, new: 3 }) },
    errors: {},
    ...overrides,
  }
}

export function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 1,
    title: 'Softwareentwickler (m/w/d)',
    company: 'Beispiel GmbH',
    location: 'Berlin',
    remote: 'hybrid',
    posted_at: '2026-10-12T08:46:10Z',
    employment_type: null,
    salary_text: null,
    description: 'Wir suchen einen Softwareentwickler für unser Team.',
    description_is_snippet: true,
    language: 'de',
    first_seen_run_id: 1,
    first_seen_at: '2026-10-13T08:01:00Z',
    status: 'new',
    status_changed_at: null,
    note: '',
    filter_reason: null,
    match: true,
    match_reason: 'Mid-level .NET role in Berlin.',
    owner_label: null,
    sources: [{ source: 'stepstone', url: 'https://www.stepstone.de/jobs--x-1-inline.html' }],
    ...overrides,
  }
}

/**
 * A tiny in-memory backend for jobs: GET /api/jobs answers with all of them (pages filter
 * the list themselves), GET /api/jobs/{id} with one, and PATCH /api/jobs/{id} applies the
 * change. Returns the routes and the list of PATCH bodies received.
 */
export function jobRoutes(jobs: Job[]) {
  const patches: { id: number; body: Record<string, unknown> }[] = []
  const routes: Record<string, Handler> = { 'GET /api/jobs': () => ({ body: jobs }) }
  for (const job of jobs) {
    routes[`GET /api/jobs/${job.id}`] = () => ({ body: job })
    routes[`PATCH /api/jobs/${job.id}`] = async (request) => {
      const body: Record<string, unknown> = await request.json()
      patches.push({ id: job.id, body })
      Object.assign(job, body, body.status ? { status_changed_at: '2026-10-13T09:00:00Z' } : {})
      return { body: job }
    }
  }
  return { routes, patches }
}

/** Text of the breadcrumb in the top bar, e.g. "Jobs Matches". */
export function breadcrumb(): string {
  const banner = document.querySelector('header')
  return [...(banner?.querySelectorAll(':scope > div:first-child > span') ?? [])]
    .map((crumb) => crumb.textContent?.trim())
    .join(' › ')
}
