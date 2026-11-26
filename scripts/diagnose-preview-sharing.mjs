// Run manually against the designated Preview. One small synthetic board is published.
import { chromium } from '@playwright/test'

const origin = 'https://music-images-canvas-git-experiment-74365d-robert-tomas-projects.vercel.app'
const browser = await chromium.launch({ headless: true })
const statuses = []
let downloads = 0
try {
  const creator = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await creator.newPage()
  page.on('response', (response) => {
    if (response.url().includes('/api/boardShares')) statuses.push(`${new URL(response.url()).searchParams.get('action')}:${response.status()}`)
  })
  page.on('download', () => downloads++)
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Share', exact: true }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Share a board' })
  await dialog.getByRole('button', { name: /^Share/ }).click()
  await dialog.getByLabel('Share link').waitFor({ timeout: 60000 })
  const link = await dialog.getByLabel('Share link').inputValue()
  if (!/^https:\/\/[^/]+\/share\/[a-f0-9]{48}$/.test(link)) throw new Error('Unexpected share link shape')
  const recipient = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const received = await recipient.newPage()
  received.on('response', (response) => {
    if (response.url().includes('/api/boardShares')) statuses.push(`${new URL(response.url()).searchParams.get('action')}:${response.status()}`)
  })
  received.on('download', () => downloads++)
  await received.goto(link, { waitUntil: 'domcontentloaded' })
  await received.getByRole('button', { name: 'Continue to board' }).waitFor({ timeout: 60000 })
  await received.reload({ waitUntil: 'domcontentloaded' })
  await received.getByRole('button', { name: 'Continue to board' }).waitFor({ timeout: 30000 })
  console.log(JSON.stringify({ published: true, imported: true, reopened: true, statuses, downloads }))
  await recipient.close()
  await creator.close()
} finally {
  await browser.close()
}
