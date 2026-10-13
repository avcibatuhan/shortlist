# Apify Actors

What each Actor takes and returns, as verified against its input schema and one real run
with a limit of 5. Prices are in [config/prices.yaml](../config/prices.yaml).

Rules that apply to every Actor call (see `ApifyFetcher` in
[fetch.py](../backend/src/shortlist/pipeline/fetch.py)):

- The adapter always sets the Actor's own result limit.
- The run also gets Apify's platform caps `max_items` and `max_total_charge_usd`.
  **The charge cap is required**: with only `max_items`, Apify derives the cap from the
  result price alone, and an Actor with a start fee is then aborted before it returns
  anything ("reached its maximum cost of $0.00" — seen on 2026-10-13 with StepStone).
- One Actor run per search; an Actor's start fee is therefore paid once per search.
- Network errors, 5xx and rate-limit responses are tried once more (2 attempts); every
  attempt is counted as a start in the cost estimate.

## StepStone — `memo23/stepstone-search-cheerio-ppr`

Checked 2026-10-13, build 0.0.117. Adapter:
[stepstone.py](../backend/src/shortlist/sources/stepstone.py). Anonymized sample:
[stepstone.json](../backend/tests/fixtures/stepstone.json).

### Input

| Field | What we send | Notes |
|---|---|---|
| `keyword` | search keyword | Builds `stepstone.de/work/{keyword}/in-{location}` |
| `location` | search location, if set | e.g. `berlin`, `deutschland` |
| `country` | `de` | Enum `de` / `at` / `be` |
| `postedWithin` | `1`, `3`, `7` or `all` | Only these values exist; we pick the smallest window covering the configured days |
| `includeRelatedJobs` | `false` | Drops StepStone's "recommended" padding that does not match the search |
| `enrichEmails` | `false` | **Paid extra — never enable** (also `qualifyByPayment`) |
| `maxItems` | the search's limit | Actor default is 10,000 |

Not used: `startUrls` (overrides all filters), `category`, concurrency/retry settings, `proxy`.

### Output → `Job`

| Actor field | Example | Job field | Mapping |
|---|---|---|---|
| `id` | `14447515` | `JobSource.source_job_id` | as string |
| `url` | `/jobs--…--14447515-inline.html?rltr=…` | `JobSource.url` | relative → `https://www.stepstone.de` + path, tracking query removed |
| `title` | `Softwareentwickler (m/w/d)` | `title` | |
| `companyName` | | `company` | empty string when missing (anonymous ads) |
| `location` | `Bad Schönborn bei Karlsruhe`, `Kiel, Hamburg, Hannover` | `location` | may list several cities |
| `datePosted` | `2026-10-12T10:46:10+02:00` | `posted_at` | ISO 8601 with offset, stored as UTC |
| `workFromHome` | `"0"`, `"2"` | `remote` | `"2"` → `hybrid`; everything else → `unknown` (see below) |
| `salary` | `null` in all samples | `salary_text` | used as text when present |
| `textSnippet` | first ~300 characters of the ad | `description` | HTML and entities stripped; `description_is_snippet = true` |
| — | | `employment_type` | not in the output → empty |
| — | | `language` | detected from title + snippet |

Observations:

- `textSnippet` was exactly 300 characters in every sample (the Actor's README says ~500),
  and contains entities such as `&nbsp;`.
- `workFromHome` is undocumented. `"2"` appeared on an ad offering 2 days of mobile work per
  week, so it is mapped to `hybrid`. `"0"` could mean on-site or simply "not stated", and
  `"1"` has not been seen yet — both stay `unknown` until verified.
- Unused but present: `jobBenefitsHtml` (benefit list, often mentions remote days),
  `unifiedSalary` (`min`/`max`/`currency`/`period`, all `null` in the samples), `skills`,
  `labels`, `section`, `harmonisedId`, `isSponsored`.
- With `postedWithin: 1`, narrow keywords return few results (".net entwickler" in Germany:
  1 on the test day), so a search may use less than its share of the limit.

## Indeed — `valig/indeed-jobs-scraper`

Checked 2026-10-13, build 0.0.16. Adapter:
[indeed.py](../backend/src/shortlist/sources/indeed.py). Anonymized sample:
[indeed.json](../backend/tests/fixtures/indeed.json).

### Input

| Field | What we send | Notes |
|---|---|---|
| `country` | `de` | Actor default is `us` |
| `title` | search keyword | "Job title, keywords, or company" |
| `location` | search location, if set | City, zip code or `remote`; left out = all of Germany |
| `datePosted` | `1`, `3`, `7`, `14` or `""` | Smallest window covering the configured days; `""` = any date |
| `limit` | the search's limit | 1–1000, Actor default 100 |

There are no other inputs (no radius, no job type).

### Output → `Job`

| Actor field | Example | Job field | Mapping |
|---|---|---|---|
| `key` | `44fd499253e2da43` | `JobSource.source_job_id` | |
| `url` | `https://de.indeed.com/viewjob?jk=…` | `JobSource.url` | as is (`jobUrl` is the employer's tracking link, not used) |
| `title` | | `title` | |
| `employer.name` | | `company` | empty string when missing |
| `location.city` | `Berlin` | `location` | the object also has postal code, street and coordinates (not stored) |
| `datePublished` | `2026-10-12T05:00:00.000Z` | `posted_at` | |
| `jobTypes` | `{"CF3CP": "Vollzeit", …}` | `employment_type` | labels joined with ", " |
| `baseSalary` | `{min: 42300, max: 75000, unitOfWork: "YEAR", currencyCode: "EUR"}` | `salary_text` | `42,300 - 75,000 EUR per year`; empty when min and max are `null` |
| `attributes` | `{"PAXZC": "Hybrides Arbeiten", …}` | `remote` | label `Hybrides Arbeiten` → `hybrid`, `Homeoffice` → `remote`; otherwise `unknown` |
| `description.text` | full ad as plain text | `description` | whitespace collapsed, trimmed to 6,000 characters; `description_is_snippet = false` |
| `language` | `de` | `language` | used when `de` / `en`, otherwise detected |

Observations:

- **The output contains the full description** (`description.text` and `description.html`).
- All list-like fields are `{code: label}` objects with German labels.
- `attributes` mixes skills, benefits and workplace labels. `Hybrides Arbeiten` and
  `Homeoffice` are mapped; `Homeoffice-Möglichkeit` also occurs but does not say how much, so
  it stays `unknown`.
- Fully remote jobs have `location.city` = `Home Office` (seen together with the `Homeoffice`
  label).
- `description.text` can start with icon names of the page (`work`, `location_on`, …).
- `employer` carries personal data (`ceoName`, `ceoPhotoUrl`) — not stored, and blanked in the
  fixture.

## LinkedIn — `curious_coder/linkedin-jobs-scraper`

Checked 2026-10-13, build 1.7.18. Adapter:
[linkedin.py](../backend/src/shortlist/sources/linkedin.py). Anonymized sample:
[linkedin.json](../backend/tests/fixtures/linkedin.json).

### Input

| Field | What we send | Notes |
|---|---|---|
| `keywords` | search keyword | Only used when `urls` is empty (we never send `urls`) |
| `location` | search location, if set | As typed on LinkedIn, e.g. `Germany` |
| `datePosted` | `past24Hours`, `pastWeek`, `pastMonth` or `anyTime` | Smallest window covering the configured days |
| `limitPerSource` | the search's limit | **No default — unlimited (up to ~1,000) when left out** |
| `scrapeCompany` | `false` | Default `true` costs extra requests per job; the company name is in the job anyway |

Not used: `urls`, `geoId`, `distance`, `companyIds`, `under10Applicants`, `splitByLocation`.

### Output → `Job`

| Actor field | Example | Job field | Mapping |
|---|---|---|---|
| `id` | `4478395441` | `JobSource.source_job_id` | |
| `link` | `https://de.linkedin.com/jobs/view/…-4478395441?position=2&…` | `JobSource.url` | tracking query removed |
| `title` | | `title` | |
| `companyName` | | `company` | |
| `location` | `Munich, Bavaria, Germany`, `Greater Karlsruhe Area` | `location` | English names and region wording, see deduplication below |
| `postedAt` | `2026-10-12` | `posted_at` | day only → that day 00:00 UTC |
| `employmentType` | `Full-time` | `employment_type` | |
| `salary` | `""` in all samples | `salary_text` | used as text when present |
| `descriptionText` | full ad as plain text | `description` | falls back to `descriptionHtml`; `description_is_snippet = false` |
| — | | `remote` | no workplace field in the output → `unknown` |
| — | | `language` | detected from title + description |

Observations:

- LinkedIn lists the same job once per city (e.g. one ad for Berlin and one for Frankfurt).
  These stay separate jobs, because the city is part of the fingerprint.
- The same job in the same city can also appear twice under different ids and location
  spellings (`Greater Karlsruhe Area` / `Karlsruhe, Baden-Württemberg, Germany`); these are merged.
- `seniorityLevel` was `Not Applicable` in every sample; `applicantsCount`, `industries` and
  `benefits` are not used.

## Deduplication across sources

The fingerprint is `company + title + city` (see
[dedup.py](../backend/src/shortlist/pipeline/dedup.py)). To make the three sources comparable,
the city is normalized: first entry of a list, region wording removed (`Greater … Area`,
`Metropolitan`, `am Main`, `bei …`), and English names mapped to German ones (`Munich` →
`München`, `Cologne` → `Köln`, `Nuremberg`, `Hanover`, `Brunswick`). Cities outside that short
list with different English and German names would not be merged.
