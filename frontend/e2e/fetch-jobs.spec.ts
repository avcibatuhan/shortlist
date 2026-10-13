import { expect, test } from '@playwright/test'

// Fixture data (backend/tests/e2e_server.py): LinkedIn 4, Indeed 3, StepStone 5 results that
// are 9 different jobs; the test LLM says yes to "developer" and "engineer" titles (6 of 9).
test('fetch, review with the keyboard, write a letter, track, override, and find nothing new', async ({ page }) => {
  await page.goto('/')
  const status = page.getByRole('region', { name: 'System status' })
  await expect(status.getByText(/^OK · \d+ ms$/)).toBeVisible()
  await expect(status.getByText('gemma4:12b-it-qat')).toBeVisible()
  await expect(page.getByLabel('Cost').getByText('Estimated max cost')).toBeVisible()

  // Fetch from Today
  await page.getByRole('button', { name: 'Fetch new jobs' }).click()
  const lastRun = page.getByRole('region', { name: 'Last run' })
  await expect(lastRun.getByRole('heading', { name: /Last run: finished/ })).toBeVisible()
  await expect(lastRun.getByLabel('Fetched')).toContainText('12 fetched = 9 new + 0 already known + 3 repeated')
  await expect(lastRun.getByLabel('Evaluated')).toContainText('9 new → 6 matches · 3 not matched')
  await expect(lastRun.getByRole('row', { name: /LinkedIn/ })).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Pages' })
  await expect(nav.getByRole('link', { name: /^Jobs\s*6$/ })).toBeVisible()

  // The model can be switched from the top bar on any page.
  const picker = page.getByRole('combobox', { name: 'Model' })
  await expect(picker).toHaveValue('gemma4:12b-it-qat')
  await picker.selectOption('qwen3.5:9b')
  await expect(status.getByText('qwen3.5:9b')).toBeVisible()

  // The name that signs cover letters is set in Settings
  await nav.getByRole('link', { name: /^Settings/ }).click()
  await page.getByLabel('Full name').fill('Alex Example')
  await page.getByRole('region', { name: 'Unsaved changes' }).getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Saved. The changes apply from the next run.')).toBeVisible()
  await nav.getByRole('link', { name: /^Today/ }).click()

  // Jobs: list on the left, the whole posting on the right
  await page.getByRole('region', { name: 'Needs attention' }).getByRole('link', { name: /matches to review/ }).click()
  const list = page.getByRole('region', { name: 'Matches list' })
  const rows = list.getByRole('listitem')
  const detail = page.getByRole('region', { name: 'Selected job' })
  await expect(rows).toHaveCount(6)
  await expect(detail.getByRole('region', { name: 'Verdict' })).toContainText('Software development role.')
  const shared = rows.filter({ hasText: 'Sample International' })
  await expect(shared.getByText('LinkedIn')).toBeVisible()
  await expect(shared.getByText('StepStone')).toBeVisible()

  // Cover letter for an English posting: written on request, edited, kept
  await rows.filter({ hasText: 'JUNIOR JAVA ENGINEER' }).click()
  await page.keyboard.press('c')
  const letterPane = page.getByRole('region', { name: 'Cover letter' })
  await expect(page.getByRole('region', { name: 'Posting' }).getByRole('heading', { level: 1 })).toHaveText(
    'JUNIOR JAVA ENGINEER (f/m/d)',
  )
  await letterPane.getByRole('button', { name: 'Write cover letter' }).click()
  const letter = letterPane.getByLabel('Cover letter text')
  await expect(letter).toHaveValue(/^Application for JUNIOR JAVA ENGINEER \(f\/m\/d\)\n\nDear Hiring Team,/)
  await expect(letter).toHaveValue(/Kind regards,\nAlex Example$/) // signed in code, no placeholder
  await expect(letterPane.getByText('Written by qwen3.5:9b')).toBeVisible()
  await expect(letterPane.getByText(/placeholder/)).toHaveCount(0)
  const download = page.waitForEvent('download')
  await letterPane.getByRole('button', { name: 'Download PDF' }).click()
  expect((await download).suggestedFilename()).toBe('Cover-letter-Sample-Trading.pdf')
  await letter.fill('Dear Hiring Team,\n\nmy own words.')
  await letterPane.getByRole('button', { name: /^Save changes/ }).click()
  await expect(letterPane.getByRole('heading', { name: /edited by you/ })).toBeVisible()
  await letterPane.getByRole('button', { name: /^Close/ }).click()
  await expect(rows).toHaveCount(6)

  // Decide with the keyboard: first job applied, next one saved
  const firstTitle = (await rows.first().locator('button > span > span').first().innerText()).trim()
  await page.keyboard.press('k')
  await page.keyboard.press('k')
  await page.keyboard.press('k')
  await page.keyboard.press('a')
  await expect(rows).toHaveCount(5)
  await expect(page.getByRole('status').filter({ hasText: 'marked as applied' })).toBeVisible()
  await page.keyboard.press('s')
  await expect(rows).toHaveCount(4)
  await page.keyboard.press('u') // undo the save
  await expect(rows).toHaveCount(5)

  // Tracker: the applied job is on the board; add a note
  await nav.getByRole('link', { name: /^Tracker/ }).click()
  await page.getByRole('region', { name: 'Applied' }).getByRole('button', { name: new RegExp(`^${firstTitle.slice(0, 20)}`) }).click()
  const record = page.getByRole('complementary', { name: 'Tracker record' })
  await expect(record.getByRole('radio', { name: 'Applied' })).toBeChecked()
  await record.getByPlaceholder(/Who you talked to/).fill('Sent CV')
  await record.getByPlaceholder(/Who you talked to/).blur()
  await expect(record.getByRole('status')).toHaveText('Saved')
  await expect(page.getByText('Applied this week').locator('..')).toContainText('1')

  // Override the LLM: move a rejected job to matches
  await nav.getByRole('link', { name: /^Jobs/ }).click()
  await expect(rows).toHaveCount(5)
  await page.keyboard.press('2')
  const rejected = page.getByRole('region', { name: 'Not matched list' }).getByRole('listitem')
  await expect(rejected).toHaveCount(3)
  await page.keyboard.press('n')
  await expect(rejected).toHaveCount(2)
  await page.keyboard.press('1')
  await expect(rows).toHaveCount(6)
  await expect(list.getByLabel('Your verdict')).toHaveCount(1)

  // Second fetch: nothing new, and the reason is shown
  await page.keyboard.press('f')
  await page.getByRole('button', { name: 'Fetch new jobs' }).click()
  await expect(lastRun.getByLabel('Fetched')).toContainText('12 fetched = 0 new + 12 already known + 0 repeated')

  // History lists both runs; the note survived
  await nav.getByRole('link', { name: /^History/ }).click()
  await expect(page.getByRole('region', { name: 'Runs' }).getByRole('row')).toHaveCount(3) // header + 2 runs
  await nav.getByRole('link', { name: /^Tracker/ }).click()
  await expect(page.getByRole('region', { name: 'Applied' }).getByText('Sent CV')).toBeVisible()
})
