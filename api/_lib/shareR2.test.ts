import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { ShareR2 } from './shareR2'
import type { ShareConfig } from './shareConfig'

const config: ShareConfig = {
  endpoint: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`, bucket: 'trial-bucket',
  accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-access-key',
  passwordVerifier: '', sessionSigningKey: '', allowedOrigin: 'https://trial.example.test',
}

describe('SDK presigning', () => {
  it('binds the create-only and content-type headers to the staging PUT URL', async () => {
    const result = await new ShareR2(config).signedPut('staging/test/archive.board.zip')
    const url = new URL(result.url)
    expect(url.pathname).toBe('/trial-bucket/staging/test/archive.board.zip')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(
      expect.arrayContaining(['content-type', 'if-none-match']),
    )
    expect(result.headers).toEqual({ 'Content-Type': 'application/zip', 'If-None-Match': '*' })
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
