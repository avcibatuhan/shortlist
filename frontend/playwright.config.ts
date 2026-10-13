import { defineConfig, devices } from '@playwright/test'

const BASE_URL = 'http://127.0.0.1:8010'

// One end-to-end flow against the real backend with a throwaway database and fixture data
// instead of Apify (backend/tests/e2e_server.py). Needs a built frontend: `pnpm e2e`.
export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { baseURL: BASE_URL },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'uv run python -m tests.e2e_server',
    cwd: '../backend',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
  },
})
