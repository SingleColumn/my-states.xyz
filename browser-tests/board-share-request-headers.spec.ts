import { expect, test } from '@playwright/test'
import { openApp } from './helpers'

test('browser PUT uses only the signed headers allowed by the trial CORS rule', async ({ page }) => {
  const seen: Array<{ method: string; headers: Record<string, string> }> = []
  await page.route('https://trial-r2.example.test/staging/archive.board.zip', async (route) => {
    const request = route.request()
    seen.push({ method: request.method(), headers: await request.allHeaders() })
    await route.fulfill({ status: request.method() === 'OPTIONS' ? 204 : 200,
      headers: {
        'Access-Control-Allow-Origin': new URL(page.url()).origin,
        'Access-Control-Allow-Methods': 'GET, PUT',
        'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
      },
    })
  })
  await openApp(page)
  const result = await page.evaluate(async () => {
    const response = await fetch('https://trial-r2.example.test/staging/archive.board.zip', {
      method: 'PUT', body: new Blob(['x'], { type: 'application/zip' }),
      headers: { 'Content-Type': 'application/zip', 'If-None-Match': '*' },
      cache: 'no-store', redirect: 'error',
    })
    return response.status
  })
  expect(result).toBe(200)
  expect(seen.some(({ method }) => method === 'PUT')).toBe(true)
  const put = seen.find(({ method }) => method === 'PUT')!
  expect(put.headers['content-type']).toBe('application/zip')
  expect(put.headers['if-none-match']).toBe('*')
  expect(put.headers['cache-control']).toBeUndefined()
  expect(put.headers.pragma).toBeUndefined()
})
