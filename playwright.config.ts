import { defineConfig, devices } from '@playwright/test'

/**
 * The browser suite: real Chromium, real pointer and keyboard input, against
 * the real dev server. This is a separate suite from Vitest (which runs the
 * pure-function tests in Node, see vitest.config.ts) and never shares a
 * config with it.
 *
 * The dev build is what runs here rather than the production build because
 * the "Panel report" button -- the suite's invariant check after any panel
 * mutation -- is dev-only. The server gets its own port so a developer's
 * `npm run dev` on 5173 can keep running alongside.
 */
const port = Number(process.env.BROWSER_TEST_PORT) || 5199
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './browser-tests',
  // Every test starts from a fresh browser context (a fresh IndexedDB and
  // localStorage), so tests are independent and can run in parallel. The
  // count is capped because each test mounts a full tldraw + MDXEditor app.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // The viewport is set after the device profile (which would make it
  // 1280x720): the three default panels are 720 page units tall and must
  // fit on screen with the toolbar for a drag on any part of them to land.
  //
  // The themed projects run the same specs with a built-in theme selected
  // before each test (see openApp in helpers.ts): one dark, one light, so
  // both of tldraw's colour schemes are exercised. Nothing the suite asserts
  // is about colour, so a theme that changes an outcome is a bug in the
  // theme system, not in the test. theme.spec.ts manages themes itself and
  // runs only on the default project.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-terminal', metadata: { themeId: 'terminal' }, testIgnore: /theme\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-paper', metadata: { themeId: 'paper' }, testIgnore: /theme\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    env: { PORT: String(port) },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
