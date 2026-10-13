import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Job } from '@/api/client'
import { jobRoutes, makeJob, renderApp, requestsTo, STATS, stubApi, stubEventSource } from './helpers'

beforeEach(stubEventSource)

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function tracked(): Job[] {
  return [
    makeJob({ id: 1, title: 'Backend Developer', company: 'Alpha GmbH', status: 'saved', status_changed_at: daysAgo(4) }),
    makeJob({ id: 2, title: 'AI Engineer', status: 'applied', status_changed_at: daysAgo(6), note: 'Sent CV.' }),
    makeJob({ id: 3, title: 'Fullstack Developer', status: 'applied', status_changed_at: daysAgo(0) }),
    makeJob({ id: 4, title: 'ML Engineer', status: 'interview', status_changed_at: daysAgo(1) }),
    makeJob({ id: 5, title: 'Old Role', status: 'rejected', status_changed_at: daysAgo(30) }),
  ]
}

function column(name: string) {
  return within(screen.getByRole('region', { name }))
}

function cards(name: string): string[] {
  return column(name)
    .queryAllByRole('button')
    .filter((button) => button.closest('li'))
    .map((card) => card.querySelector('span')?.textContent ?? '')
}

async function open(title: string) {
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${title}`) }))
  return within(screen.getByRole('complementary', { name: 'Tracker record' }))
}

describe('Tracker page', () => {
  it('shows tracked jobs in their stage with how long they have been there', async () => {
    const fetchMock = stubApi({ 'GET /api/jobs': { body: tracked() } })
    renderApp('/tracker')

    expect(await screen.findByRole('heading', { name: /^Applied\s*2$/ })).toBeInTheDocument()
    expect(cards('Saved')).toEqual(['Backend Developer'])
    expect(cards('Applied')).toEqual(['AI Engineer', 'Fullstack Developer'])
    expect(column('Saved').getByText('saved 4 days ago')).toBeInTheDocument()
    expect(column('Applied').getByText('applied today')).toBeInTheDocument()
    expect(column('Interview').getByText('interview since 1 day ago')).toBeInTheDocument()
    expect(column('Applied').getByText('Sent CV.')).toBeInTheDocument() // note preview
    const [request] = requestsTo(fetchMock, 'GET', '/api/jobs')
    expect(new URL(request.url).searchParams.get('tracked')).toBe('true')
  })

  it('keeps rejected jobs folded away until asked', async () => {
    stubApi({ 'GET /api/jobs': { body: tracked() } })
    renderApp('/tracker')

    expect(await screen.findByRole('heading', { name: /^Rejected\s*1/ })).toBeInTheDocument()
    expect(cards('Rejected')).toEqual([])
    await userEvent.click(column('Rejected').getByRole('button', { name: 'Show' }))
    expect(cards('Rejected')).toEqual(['Old Role'])
  })

  it('shows the counters and the number of jobs per stage', async () => {
    stubApi({
      'GET /api/jobs': { body: tracked() },
      'GET /api/stats': { body: { ...STATS, applied_this_week: 2, interviews_total: 1 } },
    })
    renderApp('/tracker')

    await waitFor(() => expect(screen.getByText('Applied this week').nextSibling).toHaveTextContent('2'))
    expect(screen.getByText('Interviews in total').nextSibling).toHaveTextContent('1')
    const stages = within(screen.getByRole('list', { name: 'Stages' }))
    expect(stages.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '1Saved',
      '2Applied',
      '1Interview',
      '1Rejected',
    ])
  })

  it('marks jobs that have not moved for a long time', async () => {
    stubApi({
      'GET /api/jobs': {
        body: [
          makeJob({ id: 1, title: 'Stale Saved', status: 'saved', status_changed_at: daysAgo(16) }),
          makeJob({ id: 2, title: 'Fresh Saved', status: 'saved', status_changed_at: daysAgo(14) }),
          makeJob({ id: 3, title: 'Stale Applied', status: 'applied', status_changed_at: daysAgo(22) }),
        ],
      },
    })
    renderApp('/tracker')

    expect(await screen.findByText('no change for 16 days')).toBeInTheDocument()
    expect(screen.getByText('no change for 22 days')).toBeInTheDocument()
    expect(screen.getAllByText(/no change for/)).toHaveLength(2)
  })

  it('opens a record with the posting, the stage and a way to the cover letter', async () => {
    stubApi({ 'GET /api/jobs': { body: tracked() } })
    renderApp('/tracker')

    const record = await open('AI Engineer')

    expect(record.getByRole('heading', { level: 2, name: 'AI Engineer' })).toBeInTheDocument()
    expect(record.getByRole('radio', { name: 'Applied' })).toBeChecked()
    expect(record.getByRole('link', { name: 'Open cover letter' })).toHaveAttribute('href', '/letter/2')
    expect(record.getByLabelText('Note for AI Engineer')).toHaveValue('Sent CV.')
    expect(record.getByRole('region', { name: 'Description' })).toBeInTheDocument()

    await userEvent.click(record.getByRole('button', { name: 'Close record' }))
    expect(screen.queryByRole('complementary', { name: 'Tracker record' })).not.toBeInTheDocument()
  })

  it('moves a job to another stage from the record', async () => {
    const { routes, patches } = jobRoutes(tracked())
    stubApi(routes)
    renderApp('/tracker')

    const record = await open('AI Engineer')
    await userEvent.click(record.getByRole('radio', { name: 'Interview' }))
    expect(cards('Interview')).toEqual(['AI Engineer', 'ML Engineer'])
    await userEvent.click(record.getByRole('button', { name: 'Move to Rejected' }))

    expect(patches).toEqual([
      { id: 2, body: { status: 'interview' } },
      { id: 2, body: { status: 'rejected' } },
    ])
  })

  it('moves the selected card with the arrow keys', async () => {
    const { routes, patches } = jobRoutes(tracked())
    stubApi(routes)
    renderApp('/tracker')

    const record = await open('Backend Developer')
    await userEvent.click(record.getByRole('heading', { level: 2, name: 'Backend Developer' })) // focus off the card
    await userEvent.keyboard('{ArrowRight}')
    expect(cards('Applied')).toContain('Backend Developer')
    await userEvent.keyboard('{ArrowLeft}')
    await userEvent.keyboard('{ArrowLeft}') // already in the first stage: nothing

    expect(patches).toEqual([
      { id: 1, body: { status: 'applied' } },
      { id: 1, body: { status: 'saved' } },
    ])
  })

  it('takes a job off the board when it is ignored or moved back to new', async () => {
    const { routes, patches } = jobRoutes(tracked())
    stubApi(routes)
    renderApp('/tracker')

    await userEvent.click((await open('Backend Developer')).getByRole('button', { name: 'Ignore job' }))
    expect(screen.queryByRole('button', { name: /^Backend Developer/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Tracker record' })).not.toBeInTheDocument()

    await userEvent.click((await open('ML Engineer')).getByRole('button', { name: 'Move back to new' }))
    expect(patches).toEqual([
      { id: 1, body: { status: 'ignored' } },
      { id: 4, body: { status: 'new' } },
    ])
  })

  it('saves a note when leaving the field, and only if it changed', async () => {
    const { routes, patches } = jobRoutes(tracked())
    stubApi(routes)
    renderApp('/tracker')

    const record = await open('Backend Developer')
    const note = record.getByLabelText('Note for Backend Developer')
    await userEvent.click(note)
    await userEvent.tab()
    expect(patches).toEqual([])

    await userEvent.type(note, 'Interview on Friday')
    expect(record.getByRole('status')).toHaveTextContent('Not saved yet')
    await userEvent.tab()
    expect(patches).toEqual([{ id: 1, body: { note: 'Interview on Friday' } }])
    await waitFor(() => expect(record.getByRole('status')).toHaveTextContent(/^Saved$/))
  })

  it('filters the board by title or company', async () => {
    stubApi({ 'GET /api/jobs': { body: tracked() } })
    renderApp('/tracker')

    await userEvent.type(await screen.findByRole('searchbox', { name: 'Filter tracked jobs' }), 'alpha')

    expect(cards('Saved')).toEqual(['Backend Developer'])
    expect(cards('Applied')).toEqual([])
  })

  it('points to Jobs when nothing is tracked', async () => {
    stubApi()
    renderApp('/tracker')

    expect(await screen.findByText('Nothing tracked yet')).toBeInTheDocument()
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', '/jobs/matches')
  })
})
