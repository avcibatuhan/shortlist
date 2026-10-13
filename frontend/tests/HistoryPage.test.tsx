import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { jobRoutes, makeJob, makeRun, makeStats, renderApp, requestsTo, stubApi, stubEventSource } from './helpers'

beforeEach(stubEventSource)

const RUNS = [
  makeRun({
    id: 2,
    state: 'partial',
    limits: { linkedin: 5, stepstone: 5 },
    fetched: 9,
    new: 0,
    already_known: 9,
    matched: 4,
    sources: { stepstone: makeStats({ fetched: 9, new: 0, known: 9 }) },
    errors: { linkedin: 'run FAILED' },
  }),
  makeRun({ id: 1 }),
]

describe('History page', () => {
  it('lists past runs with status, counts, cost and errors', async () => {
    stubApi({ 'GET /api/runs': { body: RUNS } })
    renderApp('/history')

    const runs = within(await screen.findByRole('region', { name: 'Runs' }))
    const rows = runs.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByRole('rowheader')).toHaveTextContent('#2')
    const cells = within(rows[0]).getAllByRole('cell').map((cell) => cell.textContent)
    expect(cells.slice(1)).toEqual(['Partial', 'LinkedIn 5 · StepStone 5', '9 / 0 new', '4', '$0.02', 'LinkedIn: run FAILED'])
    expect(within(rows[1]).getByText('Done')).toBeInTheDocument()
    expect(within(rows[1]).getByRole('link', { name: '#1' })).toHaveAttribute('href', '/history/1')
  })

  it('shows this month\'s cost against the budget, and earlier months', async () => {
    stubApi({
      'GET /api/runs': { body: RUNS },
      'GET /api/runs/costs': {
        body: [
          { month: '2026-10', runs: 2, cost_usd: 0.5 },
          { month: '2026-09', runs: 1, cost_usd: 1.5 },
        ],
      },
    })
    renderApp('/history')

    const cost = within(await screen.findByRole('region', { name: 'Cost this month' }))
    expect(cost.getByText('October 2026')).toBeInTheDocument()
    expect(cost.getByText('$0.50')).toBeInTheDocument()
    expect(await cost.findByRole('meter', { name: 'Budget used this month' })).toHaveAttribute(
      'aria-valuetext',
      '$0.50 of $10.00',
    )
    expect(cost.getByText('5% used')).toBeInTheDocument()
    expect(cost.getByText('Runs').nextSibling).toHaveTextContent('2')
    expect(cost.getByText('Avg cost / run').nextSibling).toHaveTextContent('$0.25')
    expect(within(cost.getByRole('list', { name: 'Earlier months' })).getByRole('listitem')).toHaveTextContent(
      'September 2026 · 1 run$1.50',
    )
    expect(cost.getByText(/Runs started in the Apify console are not included/)).toBeInTheDocument()
  })

  it('accounts for the latest run', async () => {
    stubApi({ 'GET /api/runs': { body: RUNS }, 'GET /api/runs/costs': { body: [{ month: '2026-10', runs: 2, cost_usd: 0.04 }] } })
    renderApp('/history')

    const latest = within(await screen.findByRole('region', { name: 'Latest run' }))
    expect(latest.getByRole('heading', { name: 'Run #2: where the jobs went' })).toBeInTheDocument()
    expect(latest.getByLabelText('Fetched')).toHaveTextContent('9 fetched = 0 new + 9 already known + 0 repeated')
    expect(latest.getByRole('row', { name: /StepStone/ })).toBeInTheDocument()
  })

  it('opens a run with its accounting and the jobs first seen in it', async () => {
    const fetchMock = stubApi({
      'GET /api/runs': { body: RUNS },
      'GET /api/runs/1': { body: RUNS[1] },
      'GET /api/jobs': {
        body: [makeJob(), makeJob({ id: 2, title: 'Werkstudent IT', match: null, filter_reason: 'Title contains "Werkstudent"' })],
      },
    })
    renderApp('/history')

    await userEvent.click(await screen.findByRole('link', { name: '#1' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Run 1' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Result' })).toHaveTextContent('Where the 5 fetched jobs went')
    const jobs = within(await screen.findByRole('region', { name: 'New jobs of this run' }))
    expect((await jobs.findAllByRole('heading', { level: 3 })).map((h) => h.textContent)).toEqual([
      'Softwareentwickler (m/w/d)',
      'Werkstudent IT',
    ])
    expect(jobs.getByText('Filtered out: Title contains "Werkstudent"')).toBeInTheDocument()
    const [jobsRequest] = requestsTo(fetchMock, 'GET', '/api/jobs')
    expect(new URL(jobsRequest.url).searchParams.get('run_id')).toBe('1')
  })

  it('restores an ignored job from its run', async () => {
    const { routes, patches } = jobRoutes([makeJob({ status: 'ignored' }), makeJob({ id: 2, title: 'Other' })])
    stubApi({ ...routes, 'GET /api/runs/1': { body: RUNS[1] } })
    renderApp('/history/1')

    const jobs = within(await screen.findByRole('region', { name: 'New jobs of this run' }))
    expect(await jobs.findByText('Ignored')).toBeInTheDocument()
    expect(jobs.getAllByRole('button', { name: /^Restore/ })).toHaveLength(1)
    await userEvent.click(jobs.getByRole('button', { name: 'Restore Softwareentwickler (m/w/d)' }))

    expect(patches).toEqual([{ id: 1, body: { status: 'new' } }])
    expect(jobs.queryByRole('button', { name: /^Restore/ })).not.toBeInTheDocument()
  })

  it('points to Today when there are no runs', async () => {
    stubApi()
    renderApp('/history')

    expect(await screen.findByText('No runs yet')).toBeInTheDocument()
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Fetch new jobs' })).toHaveAttribute('href', '/')
  })
})
