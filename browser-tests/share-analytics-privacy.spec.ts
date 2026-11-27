import { expect, test } from '@playwright/test'

test('direct share route does not expose its ID in outbound referrers or analytics requests', async ({ page }) => {
  const id = 'a'.repeat(48)
  const analytics: Array<{ url: string; body: string; referrer: string }> = []
  const referrers: Array<{ url: string; referrer: string }> = []
  page.on('request', (request) => referrers.push({ url: request.url(), referrer: request.headers().referer ?? '' }))
  await page.route('https://analytics.example.test/**', async (route) => {
    const request = route.request()
    analytics.push({ url: request.url(), body: request.postData() ?? '', referrer: request.headers().referer ?? '' })
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.route(`**/api/boardShares?action=resolve&id=${id}`, (route) => route.fulfill({
    status: 410, contentType: 'application/json', body: JSON.stringify({ error: 'This share has expired.' }),
  }))
  await page.goto(`/share/${id}`)
  await expect(page.getByRole('dialog', { name: 'Shared board' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('expired')
  await page.waitForTimeout(500)
  expect(JSON.stringify(analytics)).not.toContain(id)
  // Vite injects its dev client before the HTML meta policy is parsed; that
  // request does not exist in the production build, which sets the HTTP header.
  const leaked = () => referrers.filter((item) => item.referrer.includes(id) && !item.url.endsWith('/@vite/client'))
  expect(leaked()).toEqual([])
  await page.goto('/')
  await page.waitForTimeout(500)
  expect(JSON.stringify(analytics)).not.toContain(id)
  expect(leaked()).toEqual([])
  // The synthetic host cannot issue a real PostHog project config; the
  // deployed Preview check must confirm pageview payloads end to end.
})
