import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { breadcrumb, makeRun, MODELS, renderApp, STATS, stubApi, stubEventSource } from './helpers'

beforeEach(stubEventSource)

function status() {
  return within(screen.getByRole('region', { name: 'System status' }))
}

describe('App frame', () => {
  it('navigates between the five pages from the sidebar', async () => {
    stubApi()
    renderApp()
    const nav = screen.getByRole('navigation', { name: 'Pages' })

    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument()
    const expected = { Jobs: 'Jobs › Matches', Tracker: 'Tracker', History: 'History', Settings: 'Settings › Profile', Today: 'Today' }
    for (const [page, trail] of Object.entries(expected)) {
      await userEvent.click(within(nav).getByRole('link', { name: new RegExp(`^${page}`) }))
      expect(breadcrumb()).toBe(trail)
      expect(within(nav).getByRole('link', { name: new RegExp(`^${page}`) })).toHaveAttribute('aria-current', 'page')
    }
  })

  it('shows how many matches and saved jobs are waiting, next to their pages', async () => {
    stubApi({ 'GET /api/stats': { body: { ...STATS, new_matches: 12, saved: 3 } } })
    renderApp()
    const nav = screen.getByRole('navigation', { name: 'Pages' })

    expect(await within(nav).findByRole('link', { name: /^Jobs\s*12$/ })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /^Tracker\s*3$/ })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'History' })).toBeInTheDocument() // no badge at zero
  })

  it.each([
    ['/matches', 'Jobs › Matches'],
    ['/inbox', 'Jobs › Not matched'],
    ['/jobs', 'Jobs › Matches'],
    ['/jobs/nonsense', 'Jobs › Matches'],
  ])('redirects the old address %s', async (path, trail) => {
    stubApi()
    renderApp(path)

    expect(await screen.findByRole('navigation', { name: 'Views' })).toBeInTheDocument()
    expect(breadcrumb()).toBe(trail)
  })

  it('reports backend, database and Ollama as working', async () => {
    stubApi()
    renderApp()

    expect(await status().findByText(/^OK · \d+ ms$/)).toBeInTheDocument()
    expect(status().getByText('OK')).toBeInTheDocument()
    expect(await status().findByText('gemma4:12b-it-qat')).toBeInTheDocument()
  })

  it('shows the database problem reported by the backend', async () => {
    const detail = 'No schema revision: run `make migrate`'
    stubApi({
      'GET /api/health': { body: { status: 'degraded', database: 'error', schema_revision: null, detail } },
    })
    renderApp()

    expect(await status().findByText('Error')).toBeInTheDocument()
    expect(status().getByText(detail)).toBeInTheDocument()
  })

  it('shows the backend as unreachable when the request fails', async () => {
    stubApi({
      'GET /api/health': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    renderApp()

    expect(await status().findByText('Unreachable')).toBeInTheDocument()
    expect(status().getByText('Unknown')).toBeInTheDocument() // the database cannot be judged
  })

  it('says when Ollama cannot be reached, and why', async () => {
    const error = 'Ollama is not reachable at http://127.0.0.1:11434 (ConnectError).'
    stubApi({ 'GET /api/settings/models': { body: { ...MODELS, installed: [], error } } })
    renderApp()

    expect(await status().findByText('Unreachable')).toBeInTheDocument()
    expect(status().getByText(error)).toBeInTheDocument()
  })

  it('says how to install a model that is missing', async () => {
    stubApi({ 'GET /api/settings/models': { body: { ...MODELS, current: 'gemma4:e4b' } } })
    renderApp()

    expect(await status().findByText('Model missing')).toBeInTheDocument()
    expect(status().getByText('Run: ollama pull gemma4:e4b')).toBeInTheDocument()
  })

  it('opens the shortcut overview with ? and from the top bar', async () => {
    stubApi()
    renderApp()

    await userEvent.keyboard('?')
    const overlay = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(within(overlay).getByText('Mark applied')).toBeInTheDocument()
    expect(within(overlay).getByText('Undo last action')).toBeInTheDocument()
    expect(within(overlay).getByRole('region', { name: 'Letter & tracker' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }))
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  })

  it('goes to the fetch page with f', async () => {
    stubApi()
    renderApp('/history')
    expect(breadcrumb()).toBe('History')

    await userEvent.keyboard('f')

    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument()
  })

  it('shows an active run in the top bar of every page', async () => {
    stubApi({
      'GET /api/runs': {
        body: [makeRun({ id: 7, state: 'running', finished_at: null, limits: { indeed: 5, stepstone: 5 } })],
      },
    })
    renderApp('/settings')

    const pill = await screen.findByRole('link', { name: 'Run #7 is active: Fetching 0/2' })
    expect(pill).toHaveAttribute('href', '/')
  })
})

describe('Model picker', () => {
  it('shows the model in use among the installed models, on every page', async () => {
    stubApi()
    renderApp('/history')

    const picker = await screen.findByRole('combobox', { name: 'Model' })
    expect(picker).toHaveValue('gemma4:12b-it-qat')
    expect([...picker.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'gemma4:12b-it-qat',
      'qwen3.5:9b',
    ])
  })

  it('switches the model', async () => {
    let current = MODELS.current
    const chosen: unknown[] = []
    stubApi({
      'GET /api/settings/models': () => ({ body: { ...MODELS, current } }),
      'PUT /api/settings/model': async (request) => {
        const body: { model_name: string } = await request.json()
        chosen.push(body)
        current = body.model_name
        return { body }
      },
    })
    renderApp()

    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Model' }), 'qwen3.5:9b')

    expect(chosen).toEqual([{ model_name: 'qwen3.5:9b' }])
    expect(await status().findByText('qwen3.5:9b')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('qwen3.5:9b')
  })

  it('goes back to the saved model and says why when switching fails', async () => {
    stubApi({ 'PUT /api/settings/model': { status: 500, body: { detail: 'Database is locked' } } })
    renderApp()

    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Model' }), 'qwen3.5:9b')

    expect(await screen.findByText('Database is locked')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('gemma4:12b-it-qat')
  })

  it('marks the model in use when it is not installed', async () => {
    stubApi({ 'GET /api/settings/models': { body: { ...MODELS, current: 'gemma4:e4b' } } })
    renderApp()

    expect(await screen.findByRole('combobox', { name: 'Model' })).toHaveValue('gemma4:e4b')
    expect(screen.getByRole('option', { name: 'gemma4:e4b (not installed)' })).toBeInTheDocument()
  })
})
