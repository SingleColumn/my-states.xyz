// Read-only diagnostic: reports only public image-feed origins, never paths or tokens.
import { chromium } from '@playwright/test'

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const origins = new Set()
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (/r2\.dev|cloudflare|image.*collection/i.test(url.hostname)) origins.add(url.origin)
  })
  await page.goto('https://music-images-canvas-git-experiment-74365d-robert-tomas-projects.vercel.app', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  console.log(JSON.stringify({ publicFeedOrigins: [...origins].sort() }))
} finally { await browser.close() }
