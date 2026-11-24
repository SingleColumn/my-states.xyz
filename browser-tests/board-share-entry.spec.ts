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

test('a blocked storage upload identifies the failed stage without exposing its URL', async ({ page }) => {
  await page.route('**/api/boardShares?action=session', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"authenticated":true}',
  }))
  await page.route('**/api/boardShares?action=list*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"shares":[]}',
  }))
  await page.route('**/api/boardShares?action=create*', (route) => route.fulfill({
    status: 201, contentType: 'application/json', body: JSON.stringify({
      id: 'a'.repeat(48), url: 'https://trial-r2.example.test/staging/archive.board.zip',
      headers: { 'Content-Type': 'application/zip', 'If-None-Match': '*' },
    }),
  }))
  await page.route('https://trial-r2.example.test/staging/archive.board.zip', (route) => route.abort('failed'))
  await openApp(page)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await page.getByRole('button', { name: 'Share this board' }).click()
  await expect(page.getByRole('alert')).toContainText('could not upload the board to private storage')
  await expect(page.getByRole('alert')).not.toContainText('trial-r2.example.test')
})

test('a list refresh failure does not erase a confirmed share link', async ({ page }) => {
  const id = 'b'.repeat(48)
  let listCalls = 0
  await page.route('**/api/boardShares?action=session', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"authenticated":true}',
  }))
  await page.route('**/api/boardShares?action=list*', (route) => {
    listCalls++
    return listCalls === 1
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"shares":[]}' })
      : route.abort('failed')
  })
  await page.route('**/api/boardShares?action=create*', (route) => route.fulfill({
    status: 201, contentType: 'application/json', body: JSON.stringify({
      id, url: 'https://trial-r2.example.test/staging/archive.board.zip',
      headers: { 'Content-Type': 'application/zip', 'If-None-Match': '*' },
    }),
  }))
  await page.route('https://trial-r2.example.test/staging/archive.board.zip', (route) => route.fulfill({
    status: route.request().method() === 'OPTIONS' ? 204 : 200,
    headers: { 'Access-Control-Allow-Origin': new URL(page.url()).origin,
      'Access-Control-Allow-Methods': 'PUT',
      'Access-Control-Allow-Headers': 'Content-Type, If-None-Match' },
  }))
  await page.route('**/api/boardShares?action=complete*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ id, link: `https://trial.example.test/share/${id}` }),
  }))
  await openApp(page)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Share this board' })).toBeVisible()
  await page.getByRole('button', { name: 'Share this board' }).click()
  await expect(page.getByLabel('Share link')).toHaveValue(`https://trial.example.test/share/${id}`)
  await expect(page.getByText('The board was shared. Your share list could not be refreshed yet.')).toBeVisible()
})
