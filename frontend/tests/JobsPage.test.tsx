import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Job } from '@/api/client'
import {
  breadcrumb,
  jobRoutes,
  makeJob,
  makeRun,
  MATCH_IDLE,
  renderApp,
  requestsTo,
  STATS,
  stubApi,
  stubEventSource,
} from './helpers'

beforeEach(stubEventSource)

function threeMatches(): Job[] {
  return [
    makeJob({ id: 1, title: 'Backend Developer', company: 'Alpha GmbH', first_seen_run_id: 2 }),
    makeJob({
      id: 2,
      title: 'AI Engineer',
      company: 'Beta AG',
      location: 'Hamburg',
      remote: 'remote',
      first_seen_run_id: 2,
      match_reason: 'Python and LLM work.',
      sources: [
        { source: 'linkedin', url: 'https://de.linkedin.com/jobs/view/2' },
        { source: 'indeed', url: 'https://de.indeed.com/viewjob?jk=2' },
      ],
    }),
    makeJob({ id: 3, title: 'Fullstack Developer', company: 'Gamma SE', remote: 'unknown', first_seen_run_id: 1 }),
  ]
}

const REJECTED = makeJob({ id: 1, title: 'Senior Sales Manager', match: false, match_reason: 'Sales role.' })
const UNDECIDED = makeJob({ id: 2, title: 'Developer', match: null, match_reason: 'Ollama is not reachable.' })
const FILTERED = makeJob({
  id: 3,
  title: 'Werkstudent IT',
  match: null,
  match_reason: null,
  filter_reason: 'Title contains "Werkstudent"',
})

function list() {
  return within(screen.getByRole('region', { name: /list$/ }))
}

function titles(): string[] {
  return list()
    .queryAllByRole('listitem')
    .map((row) => row.querySelector('button > span > span')?.textContent ?? '')
}

function detail() {
  return within(screen.getByRole('region', { name: 'Selected job' }))
}

function selectedTitle(): string | undefined {
  return list()
    .queryAllByRole('button')
    .find((row) => row.getAttribute('aria-current') === 'true')
    ?.querySelector('span > span')?.textContent ?? undefined
}

async function ready() {
  await list().findAllByRole('listitem')
}

describe('Jobs page — reading', () => {
  it('lists the matches and shows the first one in full', async () => {
    const fetchMock = stubApi({
      'GET /api/jobs': {
        body: [
          makeJob({ description: 'Wir suchen einen Softwareentwickler. '.repeat(40).trim() }),
          makeJob({ id: 2, title: 'Software Engineer', company: 'Sample International', salary_text: '60,000 EUR' }),
        ],
      },
    })
    renderApp('/jobs/matches')
    await ready()

    const [first, second] = list().getAllByRole('listitem')
    expect(within(first).getByText('Beispiel GmbH · Berlin')).toBeInTheDocument()
    expect(within(first).getByText('Match')).toBeInTheDocument()
    expect(within(first).getByText('Hybrid')).toBeInTheDocument()
    expect(within(first).getByText('StepStone')).toBeInTheDocument()
    expect(within(second).getByText('60,000 EUR')).toBeInTheDocument()

    expect(detail().getByRole('heading', { level: 1, name: 'Softwareentwickler (m/w/d)' })).toBeInTheDocument()
    expect(detail().getByRole('link', { name: 'StepStone' })).toHaveAttribute(
      'href',
      'https://www.stepstone.de/jobs--x-1-inline.html',
    )
    const verdict = detail().getByRole('region', { name: 'Verdict' })
    expect(verdict).toHaveTextContent('Match· LLM')
    expect(verdict).toHaveTextContent('Mid-level .NET role in Berlin.')
    // The whole description, not a clamped preview.
    expect(detail().getByRole('region', { name: 'Description' })).toHaveTextContent(
      /^Description(Wir suchen einen Softwareentwickler\. ?){40}/,
    )
    expect(detail().getByText(/Snippet only — this source does not provide the full text/)).toBeInTheDocument()
    expect(detail().getByText('Workplace').nextSibling).toHaveTextContent('Hybrid')
    expect(detail().getByText('Posting language').nextSibling).toHaveTextContent('German')
    expect(detail().queryByText('Salary')).not.toBeInTheDocument() // unknown facts are left out

    const [request] = requestsTo(fetchMock, 'GET', '/api/jobs')
    const query = new URL(request.url).searchParams
    expect([query.get('status'), query.get('decision')]).toEqual(['new', 'match'])
  })

  it.each([
    ['not-matched', 'decision', 'no_match', REJECTED, 'No match· LLM', 'Sales role.'],
    ['undecided', 'decision', 'undecided', UNDECIDED, 'Undecided· LLM', 'Ollama is not reachable.'],
    ['filtered', 'filtered', 'true', FILTERED, 'Filtered out· prefilter', 'Title contains "Werkstudent". It was not sent to the LLM.'],
  ])('view %s asks for its jobs and explains the verdict', async (view, param, value, job, heading, reason) => {
    const fetchMock = stubApi({ 'GET /api/jobs': { body: [{ ...job }] } })
    renderApp(`/jobs/${view}`)
    await ready()

    const verdict = detail().getByRole('region', { name: 'Verdict' })
    expect(verdict).toHaveTextContent(heading)
    expect(verdict).toHaveTextContent(reason)
    const [request] = requestsTo(fetchMock, 'GET', '/api/jobs')
    expect(new URL(request.url).searchParams.get(param)).toBe(value)
  })

  it('shows how many jobs wait in every view and switches with the number keys', async () => {
    stubApi({
      'GET /api/jobs': { body: threeMatches() },
      'GET /api/stats': { body: { ...STATS, new_matches: 3, new_not_matched: 17, new_undecided: 2 } },
    })
    renderApp('/jobs/matches')
    await ready()
    const views = within(screen.getByRole('navigation', { name: 'Views' }))

    expect(views.getByRole('link', { name: /^Matches\s*3$/ })).toHaveAttribute('aria-current', 'page')
    expect(await views.findByRole('link', { name: /^Not matched\s*17$/ })).toBeInTheDocument()
    expect(views.getByRole('link', { name: /^Filtered out\s*0$/ })).toBeInTheDocument()

    await userEvent.keyboard('3')
    expect(breadcrumb()).toBe('Jobs › Undecided')
    await userEvent.keyboard('1')
    expect(breadcrumb()).toBe('Jobs › Matches')
  })

  it('groups the jobs of the latest run above earlier ones', async () => {
    stubApi({ 'GET /api/jobs': { body: threeMatches() }, 'GET /api/runs': { body: [makeRun({ id: 2 })] } })
    renderApp('/jobs/matches')
    await ready()

    expect(await list().findByRole('heading', { name: 'New in latest run (2)' })).toBeInTheDocument()
    expect(list().getByRole('heading', { name: 'Earlier (1)' })).toBeInTheDocument()
    expect(titles()).toEqual(['Backend Developer', 'AI Engineer', 'Fullstack Developer'])
  })

  it('says so when a view is empty', async () => {
    stubApi()
    renderApp('/jobs/matches')

    expect(await screen.findByText('No new matches')).toBeInTheDocument()
    expect(detail().getByText('Triage complete')).toBeInTheDocument()
    expect(detail().getByRole('link', { name: 'Go to Tracker' })).toHaveAttribute('href', '/tracker')
  })

  it('shows an error when jobs cannot be loaded', async () => {
    stubApi({ 'GET /api/jobs': { status: 500, body: { detail: 'Database is locked' } } })
    renderApp('/jobs/matches')

    expect(await screen.findByRole('alert')).toHaveTextContent('Database is locked')
  })

  it('filters by search text, run, source and workplace', async () => {
    stubApi({ 'GET /api/jobs': { body: threeMatches() }, 'GET /api/runs': { body: [makeRun({ id: 2 })] } })
    renderApp('/jobs/matches')
    await ready()
    const search = screen.getByRole('searchbox', { name: 'Search' })

    await userEvent.type(search, 'gamma')
    expect(titles()).toEqual(['Fullstack Developer'])
    expect(screen.getByText('1 of 3 jobs')).toBeInTheDocument()
    expect(detail().getByRole('heading', { level: 1 })).toHaveTextContent('Fullstack Developer')
    await userEvent.clear(search)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Run' }), 'Run: latest')
    expect(titles()).toEqual(['Backend Developer', 'AI Engineer'])
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Run' }), 'Run: all')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Source' }), 'Indeed')
    expect(titles()).toEqual(['AI Engineer'])
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Source' }), 'Source: all')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Workplace' }), 'Hybrid')
    expect(titles()).toEqual(['Backend Developer'])

    await userEvent.type(search, 'zzz')
    expect(screen.getByText('Nothing fits these filters')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear the filters' }))
    expect(titles()).toHaveLength(3)
  })
})

describe('Jobs page — deciding', () => {
  it.each([
    ['Applied', { status: 'applied' }, 'marked as applied'],
    ['Save', { status: 'saved' }, 'saved'],
    ['Ignore', { status: 'ignored' }, 'ignored'],
  ])('%s: the job leaves at once, the next one is selected, the change is saved', async (button, body, done) => {
    const { routes, patches } = jobRoutes(threeMatches())
    stubApi(routes)
    renderApp('/jobs/matches')
    await ready()

    await userEvent.click(detail().getByRole('button', { name: new RegExp(`^${button}`) }))

    expect(titles()).toEqual(['AI Engineer', 'Fullstack Developer'])
    expect(selectedTitle()).toBe('AI Engineer')
    expect(patches).toEqual([{ id: 1, body }])
    expect(screen.getByRole('status')).toHaveTextContent(`“Backend Developer” ${done}.`)
  })

  it('undoes the last action from the toast and with u', async () => {
    const { routes, patches } = jobRoutes(threeMatches())
    stubApi(routes)
    renderApp('/jobs/matches')
    await ready()

    await userEvent.click(detail().getByRole('button', { name: /^Ignore/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Undo/ }))
    await waitFor(() => expect(titles()).toContain('Backend Developer'))
    expect(patches[1]).toEqual({ id: 1, body: { status: 'new', owner_label: null } })
    expect(screen.queryByRole('button', { name: /^Undo/ })).not.toBeInTheDocument()

    await userEvent.keyboard('s')
    await userEvent.keyboard('u')
    expect(patches.slice(2)).toEqual([
      { id: 1, body: { status: 'saved' } },
      { id: 1, body: { status: 'new', owner_label: null } },
    ])
  })

  it('puts the job back when saving fails', async () => {
    stubApi({
      'GET /api/jobs': { body: threeMatches() },
      'PATCH /api/jobs/1': { status: 500, body: { detail: 'Database is locked' } },
    })
    renderApp('/jobs/matches')
    await ready()

    await userEvent.click(detail().getByRole('button', { name: /^Applied/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Database is locked')
    await waitFor(() => expect(titles()).toContain('Backend Developer'))
  })

  it('opens every source link of the selected job', async () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    stubApi({ 'GET /api/jobs': { body: threeMatches() } })
    renderApp('/jobs/matches')
    await ready()

    await userEvent.click(list().getByRole('button', { name: /AI Engineer/ }))
    await userEvent.click(detail().getByRole('button', { name: /^Open ad/ }))
    await userEvent.keyboard('o')

    expect(open.mock.calls.map(([url]) => url)).toEqual([
      'https://de.linkedin.com/jobs/view/2',
      'https://de.indeed.com/viewjob?jk=2',
      'https://de.linkedin.com/jobs/view/2',
      'https://de.indeed.com/viewjob?jk=2',
    ])
  })

  it('works with the keyboard: j/k move, a/s/i decide on the selected job', async () => {
    const { routes, patches } = jobRoutes(threeMatches())
    stubApi(routes)
    renderApp('/jobs/matches')
    await ready()

    expect(selectedTitle()).toBe('Backend Developer') // selected on arrival
    await userEvent.keyboard('j')
    expect(selectedTitle()).toBe('AI Engineer')
    expect(detail().getByRole('region', { name: 'Verdict' })).toHaveTextContent('Python and LLM work.')
    await userEvent.keyboard('k')
    await userEvent.keyboard('k') // stays on the first one
    expect(selectedTitle()).toBe('Backend Developer')

    await userEvent.keyboard('s')
    expect(selectedTitle()).toBe('AI Engineer')
    await userEvent.keyboard('a')
    await userEvent.keyboard('i')
    expect(patches).toEqual([
      { id: 1, body: { status: 'saved' } },
      { id: 2, body: { status: 'applied' } },
      { id: 3, body: { status: 'ignored' } },
    ])
    expect(titles()).toEqual([])
    expect(detail().getByText('Triage complete')).toBeInTheDocument()
  })

  it('ignores shortcuts while typing in the search field, which / focuses', async () => {
    const { routes, patches } = jobRoutes(threeMatches())
    stubApi(routes)
    renderApp('/jobs/matches')
    await ready()

    await userEvent.keyboard('/')
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveFocus()
    await userEvent.keyboard('ai')

    expect(patches).toEqual([])
    expect(titles()).toEqual(['AI Engineer'])
  })

  it('opens the cover letter of the selected job with c', async () => {
    const { routes } = jobRoutes(threeMatches())
    stubApi({ ...routes, 'GET /api/jobs/1/cover-letter': { status: 404, body: { detail: 'none' } } })
    renderApp('/jobs/matches')
    await ready()

    await userEvent.keyboard('c')

    expect(await screen.findByRole('region', { name: 'Posting' })).toHaveTextContent('Backend Developer')
    expect(breadcrumb()).toBe('Jobs › Cover letter')
  })
})

describe('Jobs page — overruling the LLM', () => {
  it('rejects a match with the button or n', async () => {
    const { routes, patches } = jobRoutes(threeMatches())
    stubApi(routes)
    renderApp('/jobs/matches')
    await ready()

    await userEvent.click(detail().getByRole('button', { name: /^Not a match/ }))
    await userEvent.keyboard('n')

    expect(patches).toEqual([
      { id: 1, body: { owner_label: false } },
      { id: 2, body: { owner_label: false } },
    ])
    expect(titles()).toEqual(['Fullstack Developer'])
    expect(screen.getByRole('status')).toHaveTextContent('“AI Engineer” marked as not a match.')
  })

  it('moves a rejected job to matches', async () => {
    const { routes, patches } = jobRoutes([{ ...REJECTED }])
    stubApi(routes)
    renderApp('/jobs/not-matched')
    await ready()

    await userEvent.click(detail().getByRole('button', { name: /^Move to matches/ }))

    expect(patches).toEqual([{ id: 1, body: { owner_label: true } }])
    expect(titles()).toEqual([])
    expect(screen.getByRole('status')).toHaveTextContent('“Senior Sales Manager” moved to matches.')
  })

  it('shows whose verdict it is and lets the owner take it back', async () => {
    const { routes, patches } = jobRoutes([makeJob({ match: false, owner_label: true })])
    stubApi(routes)
    renderApp('/jobs/matches')
    await ready()

    const verdict = detail().getByRole('region', { name: 'Verdict' })
    expect(verdict).toHaveTextContent('Match· your verdict (LLM: no match)')
    expect(list().getByLabelText('Your verdict')).toBeInTheDocument()
    await userEvent.click(within(verdict).getByRole('button', { name: 'Clear my verdict' }))

    expect(patches).toEqual([{ id: 1, body: { owner_label: null } }])
    expect(titles()).toEqual([])
  })

  it('re-evaluates undecided jobs and shows the progress and the result', async () => {
    let status = { ...MATCH_IDLE, undecided_jobs: 1 }
    const fetchMock = stubApi({
      'GET /api/jobs': { body: [{ ...UNDECIDED }] },
      'GET /api/match/status': () => ({ body: status }),
      'POST /api/match/reevaluate': () => {
        status = { ...MATCH_IDLE, running: true, done: 0, total: 1, undecided_jobs: 1 }
        const started = { status: 202, body: status }
        // The next poll sees it finished.
        status = { ...MATCH_IDLE, done: 1, total: 1, matched: 1, undecided_jobs: 0 }
        return started
      },
    })
    renderApp('/jobs/undecided')
    await ready()

    await userEvent.click(detail().getByRole('button', { name: 'Re-evaluate undecided' }))

    expect(await screen.findByText('LLM 0 / 1')).toBeInTheDocument()
    expect(
      await screen.findByText(/Last re-evaluation: 1 matched, 0 not matched, 0 still undecided/, undefined, {
        timeout: 3000,
      }),
    ).toBeInTheDocument()
    expect(requestsTo(fetchMock, 'POST', '/api/match/reevaluate')).toHaveLength(1)
  })

  it('shows why a re-evaluation could not start', async () => {
    stubApi({
      'GET /api/jobs': { body: [{ ...UNDECIDED }] },
      'POST /api/match/reevaluate': { status: 409, body: { detail: 'A run is active. Try again when it is done.' } },
    })
    renderApp('/jobs/undecided')
    await ready()

    await userEvent.click(detail().getByRole('button', { name: 'Re-evaluate undecided' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('A run is active')
  })
})

describe('Jobs page — label mode', () => {
  it('records a verdict per job with buttons or y/n and keeps the jobs in view', async () => {
    const { routes, patches } = jobRoutes([
      { ...REJECTED },
      makeJob({ id: 5, title: 'Junior Developer', match: false, match_reason: 'Too junior.' }),
      makeJob({ id: 6, title: 'Data Engineer', match: false, match_reason: 'Different field.' }),
    ])
    stubApi({
      ...routes,
      'GET /api/stats': { body: { ...STATS, labelled: 12, labelled_relevant: 5, labelled_not_relevant: 7 } },
    })
    renderApp('/jobs/not-matched')
    await ready()

    expect(screen.queryByRole('toolbar', { name: 'Label this job' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Label mode' }))
    expect(await screen.findByText(/12 labelled so far \(5 relevant, 7 not relevant\); aim for 50 to 100/)).toBeInTheDocument()
    expect(screen.queryByRole('toolbar', { name: 'Job actions' })).not.toBeInTheDocument()

    await userEvent.click(detail().getByRole('button', { name: /^Not relevant/ }))
    expect(selectedTitle()).toBe('Junior Developer') // moved on to the next job
    await userEvent.keyboard('y')
    await userEvent.keyboard('j') // skip the third

    expect(patches).toEqual([
      { id: 1, body: { owner_label: false } },
      { id: 5, body: { owner_label: true } },
    ])
    // Labelled jobs stay in the list while label mode is on, even when the verdict changed sides.
    expect(titles()).toEqual(['Senior Sales Manager', 'Junior Developer', 'Data Engineer'])
    expect(list().getAllByLabelText('Your verdict')).toHaveLength(2)
  })

  it('is toggled with l, and the action keys do nothing while it is on', async () => {
    const { routes, patches } = jobRoutes(threeMatches())
    stubApi(routes)
    renderApp('/jobs/matches')
    await ready()

    await userEvent.keyboard('l')
    expect(screen.getByRole('checkbox', { name: 'Label mode' })).toBeChecked()
    await userEvent.keyboard('a')
    await userEvent.keyboard('i')
    expect(patches).toEqual([])

    await userEvent.keyboard('l')
    expect(screen.getByRole('toolbar', { name: 'Job actions' })).toBeInTheDocument()
  })
})
