// Bind only the board-sharing test/production bucket as BOARD_SHARES.
// This endpoint accepts an existing pending share's upload token, never an
// object key supplied by the browser. R2.put starts only after authorization.
const MAX_BYTES = 32 * 1024 * 1024
const idPattern = /^[a-f0-9]{48}$/
const tokenPattern = /^[a-f0-9]{64}$/
const encoder = new TextEncoder()
const hex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
const reply = (status, origin) => new Response(null, { status, headers: {
  'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
} })

async function pendingStatus(bucket, id, token) {
  const object = await bucket.get(`shares/${id}/status.json`)
  if (!object || object.size > 4096) return null
  let status
  try { status = JSON.parse(await object.text()) } catch { return null }
  const verifier = hex(await crypto.subtle.digest('SHA-256', encoder.encode(token)))
  if (typeof status.uploadVerifier !== 'string' || status.uploadVerifier.length !== 64) return null
  let difference = 0
  for (let index = 0; index < 64; index++) difference |= verifier.charCodeAt(index) ^ status.uploadVerifier.charCodeAt(index)
  if (difference || status.id !== id || status.status !== 'pending' || !Number.isSafeInteger(status.uploadDeadline)
    || Date.now() > status.uploadDeadline || !Number.isSafeInteger(status.byteLength)
    || status.byteLength < 1 || status.byteLength > MAX_BYTES
    || !new RegExp(`^staging/${id}/[a-f0-9]{32}\\.board\\.zip$`).test(status.stagingKey)) return null
  return status
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin')
    const allowed = env.BOARD_SHARE_ALLOWED_ORIGIN
    if (!allowed || origin !== allowed || !env.BOARD_SHARES) return reply(403)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'PUT',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store', Vary: 'Origin',
    } })
    const path = new URL(request.url).pathname
    const id = /^\/upload\/([a-f0-9]{48})$/.exec(path)?.[1]
    if (request.method !== 'PUT' || !id || !idPattern.test(id) || new URL(request.url).search) return reply(404, allowed)
    if (request.headers.get('Content-Type') !== 'application/zip') return reply(415, allowed)
    const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization') ?? '')?.[1]
    if (!token || !tokenPattern.test(token) || !request.body) return reply(403, allowed)
    const status = await pendingStatus(env.BOARD_SHARES, id, token)
    if (!status) return reply(403, allowed)
    if (await env.BOARD_SHARES.head(status.stagingKey)) return reply(412, allowed)
    const length = Number(request.headers.get('Content-Length'))
    if (Number.isFinite(length) && length > status.byteLength) return reply(413, allowed)

    // R2 requires a known-length stream. Hold the last byte until the source
    // reaches EOF: an extra byte can never be accepted after R2 commits.
    const { readable, writable } = new FixedLengthStream(status.byteLength)
    const writer = writable.getWriter()
    const reader = request.body.getReader()
    const onlyIf = new Headers({ 'If-None-Match': '*' })
    const put = env.BOARD_SHARES.put(status.stagingKey, readable, {
      onlyIf, httpMetadata: { contentType: 'application/zip', cacheControl: 'no-store' },
    })
    // A competing conditional PUT may settle before consuming our stream.
    // Abort the writer so its pending write cannot hang indefinitely.
    void put.then((stored) => { if (!stored) void writer.abort('Already stored.').catch(() => undefined) },
      () => { void writer.abort('Storage failed.').catch(() => undefined) })
    let size = 0
    let tail
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (size + value.byteLength > status.byteLength) {
          await reader.cancel().catch(() => undefined)
          await writer.abort('Upload exceeds declared size.').catch(() => undefined)
          await put.catch(() => undefined)
          return reply(413, allowed)
        }
        size += value.byteLength
        if (!value.byteLength) continue
        if (tail) await writer.write(tail)
        if (value.byteLength > 1) await writer.write(value.subarray(0, -1))
        tail = value.subarray(-1)
      }
      if (size !== status.byteLength || !tail || !await pendingStatus(env.BOARD_SHARES, id, token)) {
        await writer.abort('Upload incomplete or expired.').catch(() => undefined)
        await put.catch(() => undefined)
        return reply(409, allowed)
      }
      await writer.write(tail)
      await writer.close()
      const stored = await put
      if (!stored) return reply(412, allowed)
      // Completion or cleanup may have advanced while R2 was writing.
      if (!await pendingStatus(env.BOARD_SHARES, id, token)) {
        await env.BOARD_SHARES.delete(status.stagingKey)
        return reply(409, allowed)
      }
      return reply(200, allowed)
    } catch {
      await writer.abort('Upload failed.').catch(() => undefined)
      const stored = await put.catch(() => undefined)
      return reply(stored === null ? 412 : 503, allowed)
    } finally { reader.releaseLock(); writer.releaseLock() }
  },
}
