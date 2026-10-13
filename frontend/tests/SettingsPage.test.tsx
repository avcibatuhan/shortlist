import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ModelTest, SettingsBody } from '@/api/client'
import { breadcrumb, renderApp, SETTINGS, stubApi, stubEventSource } from './helpers'

beforeEach(stubEventSource)

const TEST_OK: ModelTest = {
  ok: true,
  model_name: 'qwen3.5:9b',
  latency_ms: 1840,
  match: true,
  reason: 'Mid-level .NET role in Berlin.',
  gpu_percent: 100,
  context_length: 8192,
}

/** Backend stand-in that stores what is saved and answers with it. */
function settingsRoutes() {
  const saved: SettingsBody[] = []
  let current = SETTINGS
  return {
    saved,
    routes: {
      'GET /api/settings': () => ({ body: current }),
      'PUT /api/settings': async (request: Request) => {
        const body: SettingsBody = await request.json()
        saved.push(body)
        current = { ...current, ...body }
        return { body: current }
      },
    },
  }
}

function rail() {
  return within(screen.getByRole('navigation', { name: 'Settings sections' }))
}

async function go(section: string) {
  await userEvent.click(rail().getByRole('link', { name: new RegExp(`^${section}`) }))
}

function bar() {
  return within(screen.getByRole('region', { name: 'Unsaved changes' }))
}

describe('Settings page', () => {
  it('opens on the profile and shows one section at a time', async () => {
    stubApi()
    renderApp('/settings')

    expect(await screen.findByLabelText('Profile text')).toHaveValue('- .NET developer, 3 years')
    expect(breadcrumb()).toBe('Settings › Profile')
    expect(screen.queryByLabelText('Terms, one per line')).not.toBeInTheDocument()

    await go('Filters')
    expect(breadcrumb()).toBe('Settings › Filters')
    expect(screen.getByLabelText('Terms, one per line')).toHaveValue('Werkstudent\nPraktikum')
    expect(screen.queryByLabelText('Profile text')).not.toBeInTheDocument()
  })

  it('has a field for the name that signs cover letters', async () => {
    stubApi({ 'GET /api/settings': { body: { ...SETTINGS, full_name: 'Ada Lovelace' } } })
    renderApp('/settings/profile')

    expect(await screen.findByLabelText('Full name')).toHaveValue('Ada Lovelace')
    expect(screen.getByText(/Written at the end of every cover letter and on its PDF/)).toBeInTheDocument()
  })

  it('shows the saved searches, budget, prices and model', async () => {
    stubApi()
    renderApp('/settings/searches')

    expect(await screen.findByLabelText('StepStone search 1: keyword')).toHaveValue('.net entwickler')
    expect(screen.getByLabelText('StepStone search 2: posted within days')).toHaveValue(null) // any date
    expect(screen.getByLabelText('Indeed search 1: location')).toHaveValue('')
    expect(screen.getByLabelText('LinkedIn default limit')).toHaveValue(5)

    await go('Budget & prices')
    expect(screen.getByLabelText('Monthly budget (USD)')).toHaveValue(10)
    expect(screen.getByLabelText('StepStone price per start')).toHaveValue(0.005)

    await go('Model & Ollama')
    expect(screen.getByLabelText('Model name')).toHaveValue('qwen3.5:9b')
    expect(screen.getByText(/served by Ollama at http:\/\/127\.0\.0\.1:11434/)).toBeInTheDocument()
  })

  it('shows whether the Apify token is configured, never the token', async () => {
    stubApi()
    renderApp('/settings/apify')
    expect(await screen.findByText('Configured')).toBeInTheDocument()
  })

  it('says when the Apify token is missing', async () => {
    stubApi({ 'GET /api/settings': { body: { ...SETTINGS, apify_token_configured: false } } })
    renderApp('/settings/apify')

    expect(await screen.findByText(/Missing — add APIFY_TOKEN to \.env/)).toBeInTheDocument()
  })

  it('keeps edits across sections and saves them together', async () => {
    const { routes, saved } = settingsRoutes()
    stubApi(routes)
    renderApp('/settings/profile')

    const profile = await screen.findByLabelText('Profile text')
    await userEvent.clear(profile)
    await userEvent.type(profile, '- Python developer')
    await userEvent.type(screen.getByLabelText('Full name'), ' Ada Lovelace ')
    expect(bar().getByText('You have unsaved changes in Profile')).toBeInTheDocument()

    await go('Searches')
    await userEvent.click(screen.getByRole('button', { name: 'Remove StepStone search 1' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Indeed' })).getByRole('button', { name: 'Add search' }))
    await userEvent.type(screen.getByLabelText('Indeed search 2: keyword'), 'python')
    await userEvent.type(screen.getByLabelText('Indeed search 2: location'), 'Berlin')
    await userEvent.clear(screen.getByLabelText('LinkedIn default limit'))
    await userEvent.type(screen.getByLabelText('LinkedIn default limit'), '25')

    await go('Filters')
    await userEvent.type(screen.getByLabelText('Terms, one per line'), '\nSenior')

    await go('Budget & prices')
    await userEvent.clear(screen.getByLabelText('Monthly budget (USD)'))
    await userEvent.type(screen.getByLabelText('Monthly budget (USD)'), '4.5')
    await userEvent.clear(screen.getByLabelText('LinkedIn price per 1,000 results'))
    await userEvent.type(screen.getByLabelText('LinkedIn price per 1,000 results'), '1')

    await go('Model & Ollama')
    await userEvent.clear(screen.getByLabelText('Model name'))
    await userEvent.type(screen.getByLabelText('Model name'), 'gemma4:e4b')

    expect(bar().getByText(/unsaved changes in Profile and Searches and Filters and Budget & prices and Model & Ollama/)).toBeInTheDocument()
    expect(rail().getAllByText('changed')).toHaveLength(5)
    await userEvent.click(bar().getByRole('button', { name: 'Save settings' }))

    expect(await screen.findByText('Saved. The changes apply from the next run.')).toBeInTheDocument()
    expect(saved).toEqual([
      {
        full_name: 'Ada Lovelace',
        profile_text: '- Python developer',
        searches: {
          linkedin: SETTINGS.searches.linkedin,
          indeed: [
            { keyword: '.net entwickler', location: null, posted_within_days: 1 },
            { keyword: 'python', location: 'Berlin', posted_within_days: 1 },
          ],
          stepstone: [{ keyword: 'softwareentwickler', location: 'deutschland', posted_within_days: null }],
        },
        default_limits: { linkedin: 25, indeed: 5, stepstone: 5 },
        exclude_terms: ['Werkstudent', 'Praktikum', 'Senior'],
        monthly_budget_usd: 4.5,
        prices: { ...SETTINGS.prices, linkedin: { per_1000_results: 1, per_start: 0.00005 } },
        model_name: 'gemma4:e4b',
      },
    ])
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Model name')).toHaveValue('gemma4:e4b')
  })

  it('discards unsaved changes', async () => {
    stubApi()
    renderApp('/settings/profile')

    await userEvent.type(await screen.findByLabelText('Profile text'), ' and more')
    await userEvent.click(bar().getByRole('button', { name: 'Discard changes' }))

    expect(screen.getByLabelText('Profile text')).toHaveValue('- .NET developer, 3 years')
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument()
  })

  it('names the field when a number is missing, without sending anything', async () => {
    const { routes, saved } = settingsRoutes()
    stubApi(routes)
    renderApp('/settings/searches')

    await userEvent.clear(await screen.findByLabelText('Indeed default limit'))
    await userEvent.click(bar().getByRole('button', { name: 'Save settings' }))

    expect(bar().getByRole('alert')).toHaveTextContent('Indeed default limit must be a number.')
    expect(saved).toEqual([])
  })

  it('shows what the backend rejected', async () => {
    stubApi({
      'PUT /api/settings': {
        status: 422,
        body: {
          detail: [
            { loc: ['body', 'searches', 'indeed', 0, 'keyword'], msg: 'String should have at least 1 character' },
          ],
        },
      },
    })
    renderApp('/settings/searches')

    await userEvent.clear(await screen.findByLabelText('Indeed search 1: keyword'))
    await userEvent.click(bar().getByRole('button', { name: 'Save settings' }))

    expect(await bar().findByRole('alert')).toHaveTextContent(
      'searches › indeed › 0 › keyword: String should have at least 1 character',
    )
  })

  it('tests the connection and shows latency, the sample decision and GPU placement', async () => {
    stubApi({ 'POST /api/settings/model/test': { body: TEST_OK } })
    renderApp('/settings/model')

    await userEvent.click(await screen.findByRole('button', { name: 'Test connection' }))

    const result = await within(screen.getByRole('region', { name: 'Model and Ollama' })).findByRole('status')
    expect(result).toHaveTextContent('qwen3.5:9b answered in 1.8 s')
    expect(result).toHaveTextContent('Sample decision: match — Mid-level .NET role in Berlin.')
    expect(result).toHaveTextContent('100% of the model is on the GPU, context 8192 tokens.')
  })

  it('shows what is wrong when the model cannot be used', async () => {
    const reason = 'Model "x:1b" is not installed. Run: ollama pull x:1b'
    stubApi({
      'POST /api/settings/model/test': {
        body: { ...TEST_OK, ok: false, model_name: 'x:1b', match: null, reason, gpu_percent: null, context_length: null },
      },
    })
    renderApp('/settings/model')

    await userEvent.click(await screen.findByRole('button', { name: 'Test connection' }))

    const result = await within(screen.getByRole('region', { name: 'Model and Ollama' })).findByRole('status')
    expect(result).toHaveTextContent('x:1b did not work')
    expect(result).toHaveTextContent(reason)
  })

  it('warns when part of the model runs on the CPU', async () => {
    stubApi({ 'POST /api/settings/model/test': { body: { ...TEST_OK, gpu_percent: 71 } } })
    renderApp('/settings/model')

    await userEvent.click(await screen.findByRole('button', { name: 'Test connection' }))

    expect(await within(screen.getByRole('region', { name: 'Model and Ollama' })).findByRole('status')).toHaveTextContent(
      '71% of the model is on the GPU, context 8192 tokens. The rest runs on the CPU, which is much slower.',
    )
  })

  it('tests only the saved model', async () => {
    stubApi()
    renderApp('/settings/model')

    await userEvent.type(await screen.findByLabelText('Model name'), '-test')

    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled()
    expect(screen.getByText('Save your changes before testing the model.')).toBeInTheDocument()
  })
})
