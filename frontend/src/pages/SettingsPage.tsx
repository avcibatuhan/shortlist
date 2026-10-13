import { CircleAlert, CircleCheck, Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useParams } from 'react-router'
import type { ModelTest, Settings, SettingsBody, SourceName } from '@/api/client'
import { useSaveSettings, useSettings, useTestModel } from '@/api/hooks'
import { Chip } from '@/components/Chip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SETTINGS_SECTIONS, type SettingsSlug } from '@/lib/settings-sections'
import { SOURCE_LABELS } from '@/lib/sources'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

const SOURCES = Object.keys(SOURCE_LABELS) as SourceName[]

// The form keeps numbers as typed text, so a half-typed value is not lost or reformatted.
type SearchForm = { keyword: string; location: string; days: string }
type Form = {
  name: string
  profile: string
  searches: Record<SourceName, SearchForm[]>
  limits: Record<SourceName, string>
  terms: string
  budget: string
  prices: Record<SourceName, { per1000: string; perStart: string }>
  model: string
}

function perSource<T>(value: (source: SourceName) => T): Record<SourceName, T> {
  return { linkedin: value('linkedin'), indeed: value('indeed'), stepstone: value('stepstone') }
}

function toForm(settings: Settings): Form {
  return {
    name: settings.full_name,
    profile: settings.profile_text,
    searches: perSource((source) =>
      (settings.searches[source] ?? []).map((search) => ({
        keyword: search.keyword,
        location: search.location ?? '',
        days: search.posted_within_days === null ? '' : String(search.posted_within_days),
      })),
    ),
    limits: perSource((source) => String(settings.default_limits[source] ?? '')),
    terms: settings.exclude_terms.join('\n'),
    budget: String(settings.monthly_budget_usd),
    prices: perSource((source) => ({
      per1000: String(settings.prices[source]?.per_1000_results ?? ''),
      perStart: String(settings.prices[source]?.per_start ?? ''),
    })),
    model: settings.model_name,
  }
}

const SECTION_FIELDS: Record<SettingsSlug, (keyof Form)[]> = {
  profile: ['name', 'profile'],
  searches: ['searches', 'limits'],
  filters: ['terms'],
  budget: ['budget', 'prices'],
  model: ['model'],
  apify: [],
}

function changedSections(form: Form, saved: Form): SettingsSlug[] {
  return SETTINGS_SECTIONS.map((section) => section.slug).filter((slug) =>
    SECTION_FIELDS[slug].some((field) => JSON.stringify(form[field]) !== JSON.stringify(saved[field])),
  )
}

function number(text: string, name: string): number {
  const value = Number(text)
  if (text.trim() === '' || !Number.isFinite(value)) throw new Error(`${name} must be a number.`)
  return value
}

/** The request body for a form; throws an Error naming the first field that is not a number. */
function toBody(form: Form): SettingsBody {
  return {
    full_name: form.name.trim(),
    profile_text: form.profile,
    searches: perSource((source) =>
      form.searches[source].map((search, index) => ({
        keyword: search.keyword,
        location: search.location.trim() === '' ? null : search.location,
        posted_within_days:
          search.days.trim() === ''
            ? null
            : number(search.days, `${SOURCE_LABELS[source]} search ${index + 1}: posted within`),
      })),
    ),
    default_limits: perSource((source) => number(form.limits[source], `${SOURCE_LABELS[source]} default limit`)),
    exclude_terms: form.terms
      .split('\n')
      .map((term) => term.trim())
      .filter(Boolean),
    monthly_budget_usd: number(form.budget, 'Monthly budget'),
    prices: perSource((source) => ({
      per_1000_results: number(form.prices[source].per1000, `${SOURCE_LABELS[source]} price per 1,000 results`),
      per_start: number(form.prices[source].perStart, `${SOURCE_LABELS[source]} price per start`),
    })),
    model_name: form.model.trim(),
  }
}

function Section({
  active,
  title,
  description,
  children,
}: {
  active: boolean
  title: string
  description: string
  children: ReactNode
}) {
  if (!active) return null
  return (
    <section aria-label={title} className="space-y-5">
      <div className="border-b pb-4">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

function TestResult({ result }: { result: ModelTest }) {
  const seconds = (result.latency_ms / 1000).toFixed(1)
  return (
    <div role="status" className="space-y-1 rounded-lg bg-muted px-3 py-2 text-sm">
      <p className="flex items-center gap-2 font-medium">
        {result.ok ? (
          <CircleCheck className="size-4 text-emerald-600" aria-hidden />
        ) : (
          <CircleAlert className="size-4 text-destructive" aria-hidden />
        )}
        {result.ok ? `${result.model_name} answered in ${seconds} s` : `${result.model_name} did not work`}
      </p>
      <p className="text-muted-foreground">
        {result.ok ? `Sample decision: ${result.match ? 'match' : 'no match'} — ${result.reason}` : result.reason}
      </p>
      {result.gpu_percent !== null ? (
        <p className={result.gpu_percent < 100 ? 'text-destructive' : 'text-muted-foreground'}>
          {result.gpu_percent}% of the model is on the GPU
          {result.context_length ? `, context ${result.context_length} tokens` : ''}.
          {result.gpu_percent < 100 ? ' The rest runs on the CPU, which is much slower.' : ''}
        </p>
      ) : null}
    </div>
  )
}

function SearchesEditor({
  source,
  form,
  onChange,
}: {
  source: SourceName
  form: Form
  onChange: (form: Form) => void
}) {
  const label = SOURCE_LABELS[source]
  const searches = form.searches[source]
  const setSearches = (next: SearchForm[]) =>
    onChange({ ...form, searches: { ...form.searches, [source]: next } })
  const edit = (index: number, change: Partial<SearchForm>) =>
    setSearches(searches.map((search, i) => (i === index ? { ...search, ...change } : search)))

  return (
    <fieldset className="space-y-2 border-t pt-4 first:border-t-0 first:pt-0">
      <legend className="float-left mb-2 w-full text-sm font-medium">{label}</legend>
      <ul className="clear-both space-y-2">
        {searches.map((search, index) => {
          const name = `${label} search ${index + 1}`
          return (
            // Rows have no identity of their own; the index is stable while typing.
            <li key={index} className="flex flex-wrap items-center gap-2">
              <Input
                className="w-56"
                placeholder="Keyword"
                aria-label={`${name}: keyword`}
                aria-invalid={search.keyword.trim() === ''}
                value={search.keyword}
                onChange={(event) => edit(index, { keyword: event.target.value })}
              />
              <Input
                className="w-44"
                placeholder="Location (optional)"
                aria-label={`${name}: location`}
                value={search.location}
                onChange={(event) => edit(index, { location: event.target.value })}
              />
              <Input
                type="number"
                min={1}
                className="w-20"
                placeholder="any"
                aria-label={`${name}: posted within days`}
                value={search.days}
                onChange={(event) => edit(index, { days: event.target.value })}
              />
              <span className="text-xs text-muted-foreground">days</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remove ${name}`}
                onClick={() => setSearches(searches.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setSearches([...searches, { keyword: '', location: '', days: '1' }])}
        >
          <Plus /> Add search
        </Button>
        <Label htmlFor={`limit-${source}`} className="ml-auto text-muted-foreground">
          Default limit
        </Label>
        <Input
          id={`limit-${source}`}
          type="number"
          min={1}
          max={1000}
          className="w-24"
          aria-label={`${label} default limit`}
          value={form.limits[source]}
          onChange={(event) => onChange({ ...form, limits: { ...form.limits, [source]: event.target.value } })}
        />
      </div>
    </fieldset>
  )
}

function SettingsForm({ settings, section }: { settings: Settings; section: SettingsSlug }) {
  const save = useSaveSettings()
  const test = useTestModel()
  const toast = useToast()
  const [draft, setDraft] = useState<Form | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const saved = toForm(settings)
  const form = draft ?? saved
  const changed = changedSections(form, saved)
  const dirty = changed.length > 0
  const change = (next: Form) => {
    setDraft(next)
    setProblem(null)
    save.reset()
  }

  // Closing or reloading the tab with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const submit = () => {
    let body: SettingsBody
    try {
      body = toBody(form)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'A number is not valid.')
      return
    }
    save.mutate(body, {
      onSuccess: () => {
        setDraft(null)
        toast.show('Saved. The changes apply from the next run.')
      },
    })
  }

  return (
    <form
      className="flex h-full"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <nav aria-label="Settings sections" className="hidden w-[300px] shrink-0 flex-col gap-1 border-r p-4 md:flex">
        <h2 className="label-mono mb-2 px-2">Settings</h2>
        {SETTINGS_SECTIONS.map((item) => (
          <NavLink
            key={item.slug}
            to={`/settings/${item.slug}`}
            className={({ isActive }) =>
              cn(
                'rounded-md border-l-2 px-3 py-2.5 transition-colors',
                isActive || item.slug === section
                  ? 'border-primary bg-surface-high'
                  : 'border-transparent hover:bg-muted',
              )
            }
          >
            <span className="flex items-center justify-between text-base font-medium">
              {item.label}
              {changed.includes(item.slug) ? (
                <Chip tone="warn" dot>
                  changed
                </Chip>
              ) : null}
            </span>
            <span className="font-mono text-xs text-muted-foreground">{item.hint}</span>
          </NavLink>
        ))}
      </nav>
      <div className="relative min-w-0 flex-1">
        <div className="h-full overflow-y-auto">
          <div className="mx-auto max-w-4xl space-y-6 p-6 pb-28">
            <nav aria-label="Settings sections (compact)" className="flex flex-wrap gap-1 md:hidden">
              {SETTINGS_SECTIONS.map((item) => (
                <NavLink
                  key={item.slug}
                  to={`/settings/${item.slug}`}
                  className={cn('rounded-md px-2.5 py-1 text-sm', item.slug === section ? 'bg-accent font-semibold' : 'text-muted-foreground')}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
      <Section
        active={section === 'profile'}
        title="Profile"
        description="What the LLM knows about you when it decides whether a job fits, and the name that signs your cover letters."
      >
        <Field id="full-name" label="Full name">
          <Input
            id="full-name"
            className="max-w-sm"
            maxLength={100}
            autoComplete="name"
            placeholder="Your name"
            value={form.name}
            onChange={(event) => change({ ...form, name: event.target.value })}
          />
          <p className="font-mono text-[11px] text-muted-foreground">
            Written at the end of every cover letter and on its PDF. Without it the letter ends with a
            placeholder. It is not used for the match decision.
          </p>
        </Field>
        <Field id="profile-text" label="Profile">
          <Textarea
            id="profile-text"
            rows={10}
            aria-label="Profile text"
            value={form.profile}
            onChange={(event) => change({ ...form, profile: event.target.value })}
          />
        </Field>
      </Section>

      <Section
        active={section === 'searches'}
        title="Searches"
        description="Each search starts one Actor run. A source's limit is split across its searches; narrow searches first. Posted within: days back, empty for any date."
      >
        {SOURCES.map((source) => (
          <SearchesEditor key={source} source={source} form={form} onChange={change} />
        ))}
      </Section>

      <Section
        active={section === 'filters'}
        title="Filters"
        description="New jobs with one of these in the title skip the LLM and go to Inbox › Filtered out. One per line."
      >
        <Textarea
          rows={4}
          aria-label="Terms, one per line"
          value={form.terms}
          onChange={(event) => change({ ...form, terms: event.target.value })}
        />
      </Section>

      <Section
        active={section === 'budget'}
        title="Budget and prices"
        description="The Run page warns before a run that could take this month's estimated cost over the budget. Prices are in USD, as charged by each Actor."
      >
        <Field id="budget" label="Monthly budget (USD)">
          <Input
            id="budget"
            type="number"
            min={0}
            step="any"
            className="w-32"
            value={form.budget}
            onChange={(event) => change({ ...form, budget: event.target.value })}
          />
        </Field>
        <table className="text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pr-4 pb-2 font-normal">Source</th>
              <th className="pr-4 pb-2 font-normal">Per 1,000 results</th>
              <th className="pb-2 font-normal">Per Actor start</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((source) => {
              const price = form.prices[source]
              const set = (next: Partial<typeof price>) =>
                change({ ...form, prices: { ...form.prices, [source]: { ...price, ...next } } })
              return (
                <tr key={source}>
                  <th scope="row" className="pr-4 pb-2 text-left font-medium">
                    {SOURCE_LABELS[source]}
                  </th>
                  <td className="pr-4 pb-2">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      className="w-28"
                      aria-label={`${SOURCE_LABELS[source]} price per 1,000 results`}
                      value={price.per1000}
                      onChange={(event) => set({ per1000: event.target.value })}
                    />
                  </td>
                  <td className="pb-2">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      className="w-28"
                      aria-label={`${SOURCE_LABELS[source]} price per start`}
                      value={price.perStart}
                      onChange={(event) => set({ perStart: event.target.value })}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Section>

      <Section
        active={section === 'model'}
        title="Model and Ollama"
        description={`Local LLM that decides whether a job fits, served by Ollama at ${settings.ollama_url}.`}
      >
        <div className="flex flex-wrap items-end gap-3">
          <Field id="model-name" label="Model name">
            <Input
              id="model-name"
              className="w-64"
              placeholder="qwen3.5:9b"
              value={form.model}
              onChange={(event) => change({ ...form, model: event.target.value })}
            />
          </Field>
          <Button type="button" variant="outline" disabled={dirty || test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Test connection
          </Button>
        </div>
        {dirty ? <p className="text-xs text-muted-foreground">Save your changes before testing the model.</p> : null}
        {test.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {test.error.message}
          </p>
        ) : null}
        {test.data && !test.isPending ? <TestResult result={test.data} /> : null}
      </Section>

      <Section active={section === 'apify'} title="Apify token" description="Kept in the .env file only; it is never shown or edited here.">
        <p className="flex items-center gap-2 text-sm">
          {settings.apify_token_configured ? (
            <CircleCheck className="size-4 text-emerald-600" aria-hidden />
          ) : (
            <CircleAlert className="size-4 text-destructive" aria-hidden />
          )}
          {settings.apify_token_configured
            ? 'Configured'
            : 'Missing — add APIFY_TOKEN to .env and restart the backend.'}
        </p>
      </Section>

          </div>
        </div>
        {dirty || problem || save.isError ? (
          <div
            role="region"
            aria-label="Unsaved changes"
            className="absolute inset-x-6 bottom-6 flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-popover px-4 py-3 shadow-[0_8px_24px_-4px_rgb(0_0_0/0.6)]"
          >
            <span className="size-2 rounded-full bg-warn" aria-hidden />
            <p className="text-sm font-medium">
              {dirty
                ? `You have unsaved changes in ${changed
                    .map((slug) => SETTINGS_SECTIONS.find((item) => item.slug === slug)?.label)
                    .join(' and ')}`
                : 'Not saved'}
            </p>
            {problem || save.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {problem ?? save.error?.message}
              </p>
            ) : null}
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" disabled={!dirty} onClick={() => change(saved)}>
                Discard changes
              </Button>
              <Button type="submit" disabled={!dirty || save.isPending}>
                {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Save settings
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </form>
  )
}

export function SettingsPage() {
  const settings = useSettings()
  const params = useParams()
  const section = SETTINGS_SECTIONS.find((item) => item.slug === params.section)?.slug ?? 'profile'

  if (settings.isError) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        {settings.error.message}
      </p>
    )
  }
  if (!settings.data) return <p className="p-6 text-sm text-muted-foreground">Loading settings…</p>
  return <SettingsForm settings={settings.data} section={section} />
}
