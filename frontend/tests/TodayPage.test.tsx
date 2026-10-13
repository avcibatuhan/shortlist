import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ESTIMATE,
  FakeEventSource,
  makeRun,
  makeStats,
  renderApp,
  requestsTo,
  STATS,
  stubApi,
  stubEventSource,
} from './helpers'

const RUNNING = makeRun({
  id: 7,
  state: 'running',
  finished_at: null,
  limits: { linkedin: 5, indeed: 5, stepstone: 4 },
  fetched: 0,
  new: 0,
  already_known: 0,
  sources: {},
})

const FINISHED = makeRun({
  id: 7,
  limits: { linkedin: 5, indeed: 5, stepstone: 4 },
  fetched: 12,
  new: 6,
  already_known: 3,
  duplicates_in_run: 2,
  skipped: 1,
  prefiltered_out: 1,
  matched: 2,
  not_matched: 2,
  undecided: 1,
  estimated_cost_usd: 0.031,
  sources: {
    linkedin: makeStats({ fetched: 4, new: 3, duplicates: 1, cost_usd: 0.008 }),
    indeed: makeStats({ fetched: 3, new: 2, known: 1, cost_usd: 0.003 }),
    stepstone: makeStats({ limit: 4, fetched: 5, new: 1, known: 2, duplicates: 1, skipped: 1 }),
  },
})

beforeEach(stubEventSource)

async function openLimits() {
  await userEvent.click(await screen.findByRole('button', { name: 'Change sources and limits' }))
}

describe('Today page', () => {
  it('runs all sources with their limits, shows live progress and then the result', async () => {
    let state: 'idle' | 'running' | 'done' = 'idle'
    const fetchMock = stubApi({
      'GET /api/runs': () => ({ body: state === 'idle' ? [] : [state === 'running' ? RUNNING : FINISHED] }),
      'POST /api/runs': () => {
        state = 'running'
        return { status: 202, body: RUNNING }
      },
    })
    renderApp()

    await openLimits()
    const stepstone = screen.getByLabelText('StepStone — max results')
    await userEvent.clear(stepstone)
    await userEvent.type(stepstone, '4')
    expect(screen.getByText('LinkedIn 5 · Indeed 5 · StepStone 4')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Fetch new jobs' }))

    const [post] = requestsTo(fetchMock, 'POST', '/api/runs')
    expect(await post.json()).toEqual({
      limits: { linkedin: 5, indeed: 5, stepstone: 4 },
      confirm_over_budget: false,
    })

    const progress = await screen.findByRole('status', { name: 'Run progress' })
    expect(screen.queryByRole('button', { name: /Fetch new jobs/ })).not.toBeInTheDocument()
    const [events] = FakeEventSource.instances
    expect(events.url).toBe('/api/runs/7/events')
    events.emit({
      run_id: 7,
      stage: 'fetching',
      sources: {
        linkedin: { state: 'error', fetched: 0, error: 'run FAILED' },
        indeed: { state: 'done', fetched: 3 },
        stepstone: { state: 'fetching', fetched: 0 },
      },
    })
    expect(within(progress).getByText('Done · 3 fetched')).toBeInTheDocument()
    expect(within(progress).getByText('Fetching…')).toBeInTheDocument()
    expect(within(progress).getByText('run FAILED')).toBeInTheDocument()
    expect(within(progress).getByText('Fetch')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('link', { name: 'Run #7 is active: Fetching 2/3' })).toBeInTheDocument()

    events.emit({ run_id: 7, stage: 'deduplicating' })
    expect(within(progress).getByText('Deduplicate')).toHaveAttribute('aria-current', 'step')

    events.emit({ run_id: 7, stage: 'matching', llm_done: 2, llm_total: 6 })
    expect(within(progress).getByText('LLM 2 / 6')).toHaveAttribute('aria-current', 'step')

    state = 'done'
    events.emit({ run_id: 7, stage: 'done', llm_done: 6, llm_total: 6 })
    expect(events.closed).toBe(true)

    const lastRun = await screen.findByRole('region', { name: 'Last run' })
    expect(within(lastRun).getByRole('heading', { name: /Last run: finished/ })).toBeInTheDocument()
    expect(within(lastRun).getByText('est. $0.031')).toBeInTheDocument()
    expect(within(lastRun).getByRole('link', { name: 'Show matches' })).toHaveAttribute('href', '/jobs/matches')
    expect(within(lastRun).getByRole('link', { name: 'Open details' })).toHaveAttribute('href', '/history/7')
    expect(screen.getByRole('button', { name: 'Fetch new jobs' })).toBeEnabled()
  })

  it('accounts for every fetched job, in total and per source', async () => {
    stubApi({ 'GET /api/runs': { body: [FINISHED] } })
    renderApp()

    const lastRun = await screen.findByRole('region', { name: 'Last run' })
    expect(within(lastRun).getByLabelText('Fetched')).toHaveTextContent(
      '12 fetched = 6 new + 3 already known + 2 repeated + 1 unreadable',
    )
    expect(within(lastRun).getByLabelText('Evaluated')).toHaveTextContent(
      '6 new → 2 matches · 2 not matched · 1 undecided · 1 filtered out',
    )
    const row = within(lastRun).getByRole('row', { name: /StepStone/ })
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      '4', '5', '1', '2', '1', '20%', '$0.02',
    ]) // prettier-ignore
  })

  it('greets with the last fetch', async () => {
    stubApi({ 'GET /api/runs': { body: [FINISHED] } })
    renderApp()

    expect(await screen.findByText(/Last fetch:/)).toHaveTextContent(/12 fetched · 6 new/)
  })

  it('explains what a fetch does before the first run', async () => {
    stubApi()
    renderApp()

    expect(await screen.findByText('Nothing has been fetched yet.', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No run yet' })).toBeInTheDocument()
    expect(screen.getByText(/Each result is billed by Apify/)).toBeInTheDocument()
  })

  it('keeps the limits folded away until asked', async () => {
    stubApi()
    renderApp()

    expect(await screen.findByText('LinkedIn 5 · Indeed 5 · StepStone 5')).toBeInTheDocument()
    expect(screen.queryByLabelText('StepStone — max results')).not.toBeInTheDocument()
    await openLimits()
    expect(screen.getByLabelText('StepStone — max results')).toHaveValue(5)
  })

  it('leaves out disabled sources', async () => {
    const fetchMock = stubApi({ 'POST /api/runs': { status: 202, body: RUNNING } })
    renderApp()

    await openLimits()
    await userEvent.click(screen.getByRole('switch', { name: 'LinkedIn' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Indeed' }))
    expect(screen.getByLabelText('Indeed — max results')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Fetch new jobs' }))

    const [post] = requestsTo(fetchMock, 'POST', '/api/runs')
    expect((await post.json()).limits).toEqual({ stepstone: 5 })
  })

  it('shows the estimated maximum cost and the budget used this month', async () => {
    const fetchMock = stubApi()
    renderApp()

    const cost = await screen.findByLabelText('Cost')
    expect(within(cost).getByText('Estimated max cost').nextSibling).toHaveTextContent('up to $0.034')
    const meter = within(cost).getByRole('meter', { name: 'Budget used this month' })
    expect(meter).toHaveAttribute('aria-valuetext', '$0.12 of $10.00')
    expect(within(cost).getByText('1% used')).toBeInTheDocument()
    const [estimate] = requestsTo(fetchMock, 'POST', '/api/runs/estimate')
    expect(await estimate.json()).toEqual({ limits: { linkedin: 5, indeed: 5, stepstone: 5 } })
  })

  it('asks for confirmation before a run that could exceed the budget', async () => {
    const fetchMock = stubApi({
      'POST /api/runs/estimate': {
        body: { ...ESTIMATE, max_cost_usd: 0.5, month_spent_usd: 9.8, exceeds_budget: true },
      },
      'POST /api/runs': { status: 202, body: RUNNING },
    })
    renderApp()

    expect(await screen.findByText(/over the budget/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Fetch new jobs…' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Run over the monthly budget?' })
    expect(dialog).toHaveTextContent('up to $0.50')
    expect(dialog).toHaveTextContent('$9.80 already spent')
    expect(requestsTo(fetchMock, 'POST', '/api/runs')).toHaveLength(0)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Run anyway' }))

    const [post] = requestsTo(fetchMock, 'POST', '/api/runs')
    expect((await post.json()).confirm_over_budget).toBe(true)
  })

  it('does not start an over-budget run when cancelled', async () => {
    const fetchMock = stubApi({ 'POST /api/runs/estimate': { body: { ...ESTIMATE, exceeds_budget: true } } })
    renderApp()

    await screen.findByText(/over the budget/)
    await userEvent.click(screen.getByRole('button', { name: 'Fetch new jobs…' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(requestsTo(fetchMock, 'POST', '/api/runs')).toHaveLength(0)
  })

  it('shows the progress of a run that is already active instead of the button', async () => {
    stubApi({ 'GET /api/runs': { body: [RUNNING] } })
    renderApp()

    const progress = await screen.findByRole('status', { name: 'Run progress' })
    expect(within(progress).getAllByText('Waiting')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /Fetch new jobs/ })).not.toBeInTheDocument()
  })

  it('shows why a run could not start', async () => {
    const detail = 'APIFY_TOKEN is missing. Add it to .env and restart the backend.'
    stubApi({ 'POST /api/runs': { status: 400, body: { detail } } })
    renderApp()

    await screen.findByLabelText('Cost')
    await userEvent.click(screen.getByRole('button', { name: 'Fetch new jobs' }))

    expect(await screen.findByText(detail)).toHaveAttribute('role', 'alert')
  })

  it('shows per-source errors of the last run', async () => {
    stubApi({
      'GET /api/runs': {
        body: [makeRun({ state: 'failed', fetched: 0, new: 0, errors: { stepstone: 'run FAILED' } })],
      },
    })
    renderApp()

    const lastRun = await screen.findByRole('region', { name: 'Last run' })
    expect(within(lastRun).getByRole('heading', { name: /Last run: failed/ })).toBeInTheDocument()
    expect(within(lastRun).getByRole('alert')).toHaveTextContent('StepStone: run FAILED')
  })

  it('does not allow a run without a valid limit or without sources', async () => {
    stubApi()
    renderApp()

    await openLimits()
    await userEvent.clear(screen.getByLabelText('StepStone — max results'))
    expect(screen.getByRole('button', { name: 'Fetch new jobs' })).toBeDisabled()
    expect(screen.getByText(/whole number from 1 to 1000/)).toBeInTheDocument()

    for (const name of ['LinkedIn', 'Indeed', 'StepStone']) {
      await userEvent.click(screen.getByRole('switch', { name }))
    }
    expect(screen.getByText('Enable at least one source.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fetch new jobs' })).toBeDisabled()
  })

  it('shows what needs attention, with links to where it is handled', async () => {
    stubApi({
      'GET /api/stats': {
        body: { ...STATS, new_matches: 12, new_undecided: 0, saved: 3, applied_this_week: 2, labelled: 7 },
      },
    })
    renderApp()
    const tiles = within(screen.getByRole('region', { name: 'Needs attention' }))

    expect(await tiles.findByRole('link', { name: /12\s*postings\s*matches to review/ })).toHaveAttribute(
      'href',
      '/jobs/matches',
    )
    expect(tiles.getByRole('link', { name: /3\s*saved\s*saved, not applied/ })).toHaveAttribute('href', '/tracker')
    expect(tiles.getByText('undecided').closest('a')).toBeNull() // nothing waiting: not a link
    expect(tiles.getByText('applied this week').previousSibling).toHaveTextContent('2')

    const next = within(screen.getByRole('region', { name: 'Next steps' }))
    expect(next.getByText(/12 waiting/)).toBeInTheDocument()
    expect(next.getByText('Every job has a decision.')).toBeInTheDocument()
    expect(next.getByText(/3 saved jobs wait for an application/)).toBeInTheDocument()
    expect(next.getByText('Labelled for evaluation').nextSibling).toHaveTextContent('7 jobs')
    expect(next.getByText('Model').nextSibling).toHaveTextContent('gemma4:12b-it-qat')
  })
})
