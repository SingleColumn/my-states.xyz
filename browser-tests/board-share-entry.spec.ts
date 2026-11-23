import { expect, test } from '@playwright/test'
import { openApp } from './helpers'

test('Share is visible before creator sign-in and opens its entry form', async ({ page }) => {
  await page.route('**/api/boardShares?action=session', async (route) => {
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Creator sign-in is required.' }) })
  })
  await openApp(page)
  const share = page.getByRole('button', { name: 'Share', exact: true })
  await expect(share).toBeVisible()
  await expect(share).toBeEnabled()
  await share.click()
  await expect(page.getByRole('dialog', { name: 'Share a board' })).toBeVisible()
  await expect(page.getByLabel('Creator passphrase')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})
