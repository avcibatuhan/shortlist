import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CoverLetter } from '@/api/client'
import { breadcrumb, jobRoutes, makeJob, renderApp, requestsTo, stubApi, stubEventSource } from './helpers'

const TEXT = 'Bewerbung als Softwareentwickler\n\nSehr geehrte Damen und Herren,\n\nmit großem Interesse …'

function letter(overrides: Partial<CoverLetter> = {}): CoverLetter {
  return {
    job_id: 1,
    language: 'de',
    text: TEXT,
    words: 11,
    too_long: false,
    edited: false,
    model: 'gemma4:12b-it-qat',
    latency_ms: 21000,
    updated_at: '2026-10-13T10:00:00Z',
    ...overrides,
  }
}

const NO_LETTER = { status: 404, body: { detail: 'No cover letter has been written for this job yet.' } }

beforeEach(stubEventSource)

/** Both panes are there once the job and its letter (or the lack of one) have loaded. */
function loaded() {
  return screen.findByRole('region', { name: 'Cover letter' })
}

function pane() {
  return within(screen.getByRole('region', { name: 'Cover letter' }))
}

function field() {
  return pane().findByLabelText('Cover letter text')
}

describe('Cover letter page', () => {
  it('shows the posting next to the letter, which is written only on request', async () => {
    let stored: CoverLetter | null = null
    const fetchMock = stubApi({
      ...jobRoutes([makeJob({ language: 'de', description: 'Wir suchen einen Softwareentwickler.' })]).routes,
      'GET /api/jobs/1/cover-letter': () => (stored ? { body: stored } : NO_LETTER),
      'POST /api/jobs/1/cover-letter': () => {
        stored = letter()
        return { body: stored }
      },
    })
    renderApp('/letter/1')
    await loaded()

    const posting = await screen.findByRole('region', { name: 'Posting' })
    expect(within(posting).getByRole('heading', { level: 1, name: 'Softwareentwickler (m/w/d)' })).toBeInTheDocument()
    expect(within(posting).getByText('Wir suchen einen Softwareentwickler.')).toBeInTheDocument()
    expect(within(posting).getByText(/Snippet only — the letter is based on little text/)).toBeInTheDocument()
    expect(breadcrumb()).toBe('Jobs › Cover letter')

    expect(await pane().findByText(/at most one page in/)).toHaveTextContent('German')
    expect(requestsTo(fetchMock, 'POST', '/api/jobs/1/cover-letter')).toHaveLength(0)
    await userEvent.click(pane().getByRole('button', { name: 'Write cover letter' }))

    expect(await field()).toHaveValue(TEXT)
    expect(pane().getByRole('heading', { name: 'Cover letter · German · draft' })).toBeInTheDocument()
    expect(pane().getByText('Written by gemma4:12b-it-qat in 21 s')).toBeInTheDocument()
    expect(pane().getByText(/check every statement against the posting/)).toBeInTheDocument()
    expect(requestsTo(fetchMock, 'POST', '/api/jobs/1/cover-letter')).toHaveLength(1)
    expect(within(posting).getByText('Wir suchen einen Softwareentwickler.')).toBeInTheDocument() // still there
  })

  it('announces English for an English posting', async () => {
    stubApi({ ...jobRoutes([makeJob({ language: 'en' })]).routes, 'GET /api/jobs/1/cover-letter': NO_LETTER })
    renderApp('/letter/1')
    await loaded()

    expect(await pane().findByText(/at most one page in/)).toHaveTextContent('English')
  })

  it('shows a stored letter with its length against one page', async () => {
    stubApi({
      ...jobRoutes([makeJob()]).routes,
      'GET /api/jobs/1/cover-letter': { body: letter({ edited: true }) },
    })
    renderApp('/letter/1')
    await loaded()

    expect(await field()).toHaveValue(TEXT)
    expect(pane().getByRole('heading', { name: 'Cover letter · German · edited by you' })).toBeInTheDocument()
    const length = within(pane().getByLabelText('Length'))
    expect(length.getByText('12 words')).toBeInTheDocument()
    expect(length.getByRole('meter', { name: 'Share of one page' })).toHaveAttribute('aria-valuenow', '12')
    expect(length.getByText('3% of one page (350 words)')).toBeInTheDocument()
    expect(pane().getByRole('button', { name: /^Save changes/ })).toBeDisabled()
  })

  it('warns when the text is longer than one page', async () => {
    stubApi({
      ...jobRoutes([makeJob()]).routes,
      'GET /api/jobs/1/cover-letter': { body: letter({ text: 'wort '.repeat(360).trim(), words: 360, too_long: true }) },
    })
    renderApp('/letter/1')
    await loaded()

    await field()
    expect(pane().getByText('360 words')).toBeInTheDocument()
    expect(pane().getByText('longer than one page (about 350 words)')).toBeInTheDocument()
  })

  it('saves edits and copies the edited text', async () => {
    const user = userEvent.setup()
    const saved: unknown[] = []
    stubApi({
      ...jobRoutes([makeJob()]).routes,
      'GET /api/jobs/1/cover-letter': { body: letter() },
      'PUT /api/jobs/1/cover-letter': async (request) => {
        const body: { text: string } = await request.json()
        saved.push(body)
        return { body: letter({ text: body.text, edited: true, updated_at: '2026-10-13T10:05:00Z' }) }
      },
    })
    renderApp('/letter/1')
    await loaded()

    await user.type(await field(), ' Zusatz.')
    await user.click(pane().getByRole('button', { name: /^Save changes/ }))

    expect(await pane().findByRole('heading', { name: /edited by you/ })).toBeInTheDocument()
    expect(saved).toEqual([{ text: `${TEXT} Zusatz.` }])
    expect(await field()).toHaveValue(`${TEXT} Zusatz.`)

    await user.click(pane().getByRole('button', { name: 'Copy' }))
    expect(await pane().findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe(`${TEXT} Zusatz.`)
  })

  it('downloads the letter as a PDF, saving unsaved edits first', async () => {
    const order: string[] = []
    const clicked: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download)
    })
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:pdf', revokeObjectURL: () => {} }))
    const fetchMock = stubApi({
      ...jobRoutes([makeJob()]).routes,
      'GET /api/jobs/1/cover-letter': { body: letter() },
      'PUT /api/jobs/1/cover-letter': async (request) => {
        order.push('save')
        const body: { text: string } = await request.json()
        return { body: letter({ text: body.text, edited: true, updated_at: '2026-10-13T10:05:00Z' }) }
      },
    })
    fetchMock.mockImplementation(
      ((original) => async (request: Request) => {
        if (new URL(request.url).pathname === '/api/jobs/1/cover-letter/pdf') {
          order.push('pdf')
          return new Response(new Blob(['%PDF-1.3']), {
            headers: {
              'content-type': 'application/pdf',
              'content-disposition': 'attachment; filename="Anschreiben-Beispiel-GmbH.pdf"',
            },
          })
        }
        return original(request)
      })(fetchMock.getMockImplementation()!),
    )
    renderApp('/letter/1')
    await loaded()

    await userEvent.type(await field(), ' Zusatz.')
    await userEvent.click(pane().getByRole('button', { name: 'Download PDF' }))

    await waitFor(() => expect(clicked).toEqual(['Anschreiben-Beispiel-GmbH.pdf']))
    expect(order).toEqual(['save', 'pdf'])
    expect(screen.queryByRole('button', { name: /Download \.txt/ })).not.toBeInTheDocument()
  })

  it('points to Settings when the name placeholder is still there', async () => {
    stubApi({
      ...jobRoutes([makeJob()]).routes,
      'GET /api/jobs/1/cover-letter': { body: letter({ text: `${TEXT}\n[Ihr Name]` }) },
    })
    renderApp('/letter/1')
    await loaded()

    expect(await pane().findByRole('link', { name: 'add your name in Settings' })).toHaveAttribute(
      'href',
      '/settings/profile',
    )
  })

  it('asks before copying a letter that still contains a placeholder', async () => {
    const user = userEvent.setup()
    const withPlaceholder = `${TEXT}\n\nMit freundlichen Grüßen\n[Ihr Name]`
    stubApi({
      ...jobRoutes([makeJob()]).routes,
      'GET /api/jobs/1/cover-letter': { body: letter({ text: withPlaceholder }) },
    })
    renderApp('/letter/1')
    await loaded()

    await field()
    expect(pane().getByText(/1 placeholder left: \[Ihr Name\]/)).toBeInTheDocument()
    await user.click(pane().getByRole('button', { name: 'Copy' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'The letter still contains a placeholder' })
    expect(dialog).toHaveTextContent('[Ihr Name] has not been replaced yet.')
    expect(await navigator.clipboard.readText()).toBe('')
    await user.click(within(dialog).getByRole('button', { name: 'Copy anyway' }))

    expect(await navigator.clipboard.readText()).toBe(withPlaceholder)
  })

  it('replaces the letter when written again, by button or w', async () => {
    let version = 0
    stubApi({
      ...jobRoutes([makeJob()]).routes,
      'GET /api/jobs/1/cover-letter': { body: letter() },
      'POST /api/jobs/1/cover-letter': () => {
        version += 1
        return { body: letter({ text: `Entwurf ${version}.`, updated_at: `2026-10-13T10:0${version}:00Z` }) }
      },
    })
    renderApp('/letter/1')
    await loaded()

    await userEvent.type(await field(), ' unsaved')
    await userEvent.click(pane().getByRole('button', { name: /^Write again/ }))
    expect(await pane().findByDisplayValue('Entwurf 1.')).toBeInTheDocument()

    await userEvent.click(pane().getByRole('heading', { name: /Cover letter/ })) // leave the text field
    await userEvent.keyboard('w')
    expect(await pane().findByDisplayValue('Entwurf 2.')).toBeInTheDocument()
  })

  it('says why the letter could not be written', async () => {
    const detail = 'Ollama is not reachable at http://127.0.0.1:11434 (ConnectError).'
    stubApi({
      ...jobRoutes([makeJob()]).routes,
      'GET /api/jobs/1/cover-letter': NO_LETTER,
      'POST /api/jobs/1/cover-letter': { status: 503, body: { detail } },
    })
    renderApp('/letter/1')
    await loaded()

    await userEvent.click(await pane().findByRole('button', { name: 'Write cover letter' }))

    expect(await pane().findByRole('alert')).toHaveTextContent(detail)
  })

  it('asks before closing with unsaved changes', async () => {
    stubApi({ ...jobRoutes([makeJob()]).routes, 'GET /api/jobs/1/cover-letter': { body: letter() } })
    renderApp('/letter/1')
    await loaded()

    await userEvent.type(await field(), ' more')
    await userEvent.click(pane().getByRole('button', { name: /^Close/ }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Close without saving?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(await field()).toHaveValue(`${TEXT} more`)
  })

  it('says when the job does not exist', async () => {
    stubApi({ 'GET /api/jobs/9': { status: 404, body: { detail: 'Job not found' } }, 'GET /api/jobs/9/cover-letter': NO_LETTER })
    renderApp('/letter/9')

    expect(await screen.findByRole('alert')).toHaveTextContent('Job not found')
  })
})
