import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { ShareR2 } from './shareR2'
import type { ShareConfig } from './shareConfig'

const config: ShareConfig = {
  endpoint: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`, bucket: 'trial-bucket',
  accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-access-key',
  sessionSigningKey: 'ab'.repeat(32), allowedOrigin: 'https://trial.example.test',
  uploadOrigin: 'https://trial-upload.example.workers.dev',
}

describe('SDK presigning', () => {
  it('returns the bounded upload Worker target and keeps the token out of the URL', async () => {
    const result = await new ShareR2(config).uploadTarget('staging/private', 'a'.repeat(48), 'b'.repeat(64))
    expect(result.url).toBe(`${config.uploadOrigin}/upload/${'a'.repeat(48)}`)
    expect(result.headers).toEqual({ 'Content-Type': 'application/zip', Authorization: `Bearer ${'b'.repeat(64)}` })
  })
  it('limits signed reads to two minutes', async () => {
    const url = new URL(await new ShareR2(config).signedGet('shares/test/archive.board.zip'))
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120')
  })
  it('sends distinct source and destination copy conditions through the installed SDK', async () => {
    let headers: Record<string, string | string[] | undefined> = {}
    const server = createServer((request, response) => {
      headers = request.headers
      response.writeHead(200, { 'Content-Type': 'application/xml' })
      response.end('<CopyObjectResult><ETag>"copied"</ETag></CopyObjectResult>')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('No local test port.')
      await new ShareR2({ ...config, endpoint: `http://127.0.0.1:${address.port}` })
        .copyCreateOnly('staging/source', 'shares/final', '"source"')
      expect(headers['x-amz-copy-source-if-match']).toBe('"source"')
      expect(headers['cf-copy-destination-if-none-match']).toBe('*')
      expect(headers['cache-control']).toBe('no-store')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
