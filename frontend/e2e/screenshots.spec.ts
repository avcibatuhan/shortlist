import { expect, test, type Page } from '@playwright/test'

// README screenshots and the frames of the demo GIF, from the fixture data of the e2e server
// (invented companies and ads, so nothing real is published). Run with `make screenshots`;
// skipped in the normal e2e run.
test.skip(!process.env.SCREENSHOTS, 'only with SCREENSHOTS=1')
test.use({ viewport: { width: 1440, height: 900 } })

const OUT = '../docs/screenshots'
const FRAMES = 'test-results/frames'

let frameNumber = 0
/** One frame of the GIF; `still` repeats it so the viewer can read the screen. */
async function frame(page: Page, still = 1) {
  for (let i = 0; i < still; i++) {
    frameNumber += 1
    await page.screenshot({ path: `${FRAMES}/frame-${String(frameNumber).padStart(3, '0')}.png` })
  }
}

test('README screenshots and demo frames', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Pages' })

  // Name for the cover letter
  await page.goto('/settings/profile')
  await page.getByLabel('Full name').fill('Alex Example')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Saved. The changes apply from the next run.')).toBeVisible()

  // Today: fetch
  await page.goto('/')
  await expect(page.getByLabel('Cost')).toBeVisible()
  await frame(page, 2)
  await page.getByRole('button', { name: 'Fetch new jobs' }).click()
  await expect(page.getByRole('region', { name: 'Last run' }).getByRole('heading', { name: /Last run: finished/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: /^Jobs\s*6$/ })).toBeVisible()
  await page.screenshot({ path: `${OUT}/today.png` })
  await frame(page, 3)

  // Jobs: read and decide with the keyboard
  await page.goto('/jobs/matches')
  const rows = page.getByRole('region', { name: 'Matches list' }).getByRole('listitem')
  await expect(rows).toHaveCount(6)
  await frame(page, 2)
  await page.keyboard.press('j')
  await frame(page)
  await page.keyboard.press('j')
  await frame(page)
  await page.keyboard.press('j')
  await page.screenshot({ path: `${OUT}/jobs.png` })
  await frame(page, 3)

  // Cover letter for the selected (German) posting
  await page.keyboard.press('c')
  await expect(page.getByRole('button', { name: 'Write cover letter' })).toBeVisible()
  await frame(page, 2)
  await page.getByRole('button', { name: 'Write cover letter' }).click()
  await expect(page.getByLabel('Cover letter text')).toHaveValue(/Mit freundlichen Grüßen\nAlex Example$/)
  await page.screenshot({ path: `${OUT}/cover-letter.png` })
  await frame(page, 3)
  await page.getByRole('button', { name: /^Close/ }).click()

  // Applied, then saved
  await expect(rows).toHaveCount(6)
  await page.keyboard.press('a')
  await expect(rows).toHaveCount(5)
  await frame(page, 2)
  await page.keyboard.press('s')
  await expect(rows).toHaveCount(4)
  await frame(page, 2)

  // Tracker
  await page.goto('/tracker')
  await page.getByRole('region', { name: 'Applied' }).getByRole('listitem').getByRole('button').click()
  await expect(page.getByRole('complementary', { name: 'Tracker record' })).toBeVisible()
  await page.screenshot({ path: `${OUT}/tracker.png` })
  await frame(page, 3)

  // History and Settings (stills only)
  await page.goto('/history')
  await expect(page.getByRole('region', { name: 'Runs' })).toBeVisible()
  await page.screenshot({ path: `${OUT}/history.png` })
  await page.goto('/settings/searches')
  await expect(page.getByLabel('StepStone default limit')).toBeVisible()
  await page.screenshot({ path: `${OUT}/settings.png` })
})
