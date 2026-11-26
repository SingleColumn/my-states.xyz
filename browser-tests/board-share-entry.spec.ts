import { expect, test } from '@playwright/test'
import { openApp } from './helpers'

test('Share is immediately available without a passphrase or registration', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Share a board' })).toBeVisible()
  // No heading, just the sentence and a one-word button.
  await expect(page.getByRole('dialog', { name: 'Share a board' }).getByRole('heading')).toHaveCount(0)
  await expect(page.getByText('Share a copy of this board. Your later edits stay on this board.')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Share a board' }).getByRole('button', { name: 'Share', exact: true })).toBeEnabled()
  await expect(page.getByLabel('Creator passphrase')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Disable' })).toHaveCount(0)
})

test('anonymous share shows its link and publication expiry only after confirmation', async ({ page }) => {
  const id = 'b'.repeat(48)
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000
  let completionToken: string | undefined
  await page.route('**/api/boardShares?action=create*', (route) => route.fulfill({
    status: 201, contentType: 'application/json', body: JSON.stringify({
      id, uploadToken: 'upload-only-token', url: 'https://trial-r2.example.test/staging/archive.board.zip',
      headers: { 'Content-Type': 'application/zip', 'If-None-Match': '*' },
    }),
  }))
  await page.route('https://trial-r2.example.test/staging/archive.board.zip', (route) => route.fulfill({
    status: route.request().method() === 'OPTIONS' ? 204 : 200,
    headers: { 'Access-Control-Allow-Origin': new URL(page.url()).origin,
      'Access-Control-Allow-Methods': 'PUT', 'Access-Control-Allow-Headers': 'Content-Type, If-None-Match' },
  }))
  await page.route('**/api/boardShares?action=complete*', async (route) => {
    completionToken = (route.request().postDataJSON() as { uploadToken: string }).uploadToken
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ id, link: `https://trial.example.test/share/${id}`, expiresAt }) })
  })
  await openApp(page)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByLabel('Share link')).toHaveCount(0)
  await page.getByRole('dialog', { name: 'Share a board' }).getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByLabel('Share link')).toHaveValue(`https://trial.example.test/share/${id}`)
  await expect(page.getByText('Link available for 24 hours', { exact: false })).toBeVisible()
  expect(completionToken).toBe('upload-only-token')
  await expect(page.getByText('upload-only-token')).toHaveCount(0)
})

test('a failed upload gives a retryable message without exposing its storage address', async ({ page }) => {
  await page.route('**/api/boardShares?action=create*', (route) => route.fulfill({
    status: 201, contentType: 'application/json', body: JSON.stringify({
      id: 'a'.repeat(48), uploadToken: 'upload-only-token',
      url: 'https://trial-r2.example.test/staging/archive.board.zip',
      headers: { 'Content-Type': 'application/zip', 'If-None-Match': '*' },
    }),
  }))
  await page.route('https://trial-r2.example.test/staging/archive.board.zip', (route) => route.abort('failed'))
  await openApp(page)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await page.getByRole('dialog', { name: 'Share a board' }).getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('could not be uploaded')
  await expect(page.getByRole('alert')).not.toContainText('trial-r2.example.test')
})
