// Run manually against the designated Preview. One small synthetic board is published.
import { chromium } from '@playwright/test'

const origin = 'https://music-images-canvas-git-experiment-74365d-robert-tomas-projects.vercel.app'
const browser = await chromium.launch({ headless: true })
const statuses = []
let downloads = 0
let analyticsRequests = 0
let analyticsLeak = false
let browserErrors = 0
try {
  const creator = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await creator.newPage()
  page.on('response', (response) => {
    if (response.url().includes('/api/boardShares')) statuses.push(`${new URL(response.url()).searchParams.get('action')}:${response.status()}`)
  })
  page.on('download', () => downloads++)
  page.on('pageerror', () => browserErrors++)
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Share', exact: true }).waitFor({ timeout: 30000 })
  await page.locator('input.visually-hidden-file-input').first().setInputFiles('browser-tests/fixtures/picture-folder')
  await page.locator('img.slideshow-image-layer').first().waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Share a board' })
  await dialog.getByRole('button', { name: /^Share/ }).click()
  await dialog.getByLabel('Share link').waitFor({ timeout: 60000 })
  const link = await dialog.getByLabel('Share link').inputValue()
  if (!/^https:\/\/[^/]+\/share\/[a-f0-9]{48}$/.test(link)) throw new Error('Unexpected share link shape')
  const recipient = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const received = await recipient.newPage()
  const id = new URL(link).pathname.split('/').at(-1)
  received.on('request', (request) => {
    if (!/posthog|\/_vercel\/insights/i.test(request.url())) return
    analyticsRequests++
    const sent = JSON.stringify({ url: request.url(), headers: request.headers(), body: request.postData() })
    if (sent.includes(id)) analyticsLeak = true
  })
  received.on('pageerror', () => browserErrors++)
  received.on('response', (response) => {
    if (response.url().includes('/api/boardShares')) statuses.push(`${new URL(response.url()).searchParams.get('action')}:${response.status()}`)
  })
  received.on('download', () => downloads++)
  await received.goto(link, { waitUntil: 'domcontentloaded' })
  await received.getByRole('button', { name: 'Continue to board' }).waitFor({ timeout: 60000 })
  await received.getByRole('button', { name: 'Continue to board' }).click()
  await received.locator('img.slideshow-image-layer').first().waitFor({ timeout: 30000 })
  received.on('dialog', (dialog) => dialog.accept('Recipient copy'))
  await received.getByRole('button', { name: 'Board and panel options' }).click()
  await received.getByRole('menuitem', { name: 'Rename board' }).click()
  await received.getByRole('combobox', { name: 'Open board' }).filter({ hasText: 'Recipient copy' }).waitFor()
  await received.reload({ waitUntil: 'domcontentloaded' })
  await received.getByRole('button', { name: 'Continue to board' }).waitFor({ timeout: 30000 })
  await received.getByRole('button', { name: 'Continue to board' }).click()
  await received.getByRole('combobox', { name: 'Open board' }).filter({ hasText: 'Recipient copy' }).waitFor()
  if ((await page.getByRole('combobox', { name: 'Open board' }).innerText()).includes('Recipient copy')) {
    throw new Error('Recipient edit changed the creator board.')
  }
  if (analyticsLeak) throw new Error('A share identifier appeared in an outgoing analytics request.')
  console.log(JSON.stringify({ published: true, imported: true, image: true, recipientEditPersisted: true,
    creatorIndependent: true, reopened: true, statuses, downloads, analyticsRequests, analyticsLeak, browserErrors }))
  await recipient.close()
  await creator.close()
} finally {
  await browser.close()
}
