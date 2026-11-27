import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import worker from '../worker/boardShareUpload.mjs'

globalThis.FixedLengthStream = class {
  constructor() {
    const stream = new TransformStream()
    this.readable = stream.readable
    this.writable = stream.writable
  }
}

const id = 'a'.repeat(48)
const token = 'b'.repeat(64)
const origin = 'https://trial.example.test'
const key = `staging/${id}/${'c'.repeat(32)}.board.zip`
const body = new Uint8Array(64).fill(7)
function fixture() {
  const objects = new Map()
  const status = { id, status: 'pending', stagingKey: key, byteLength: body.length,
    uploadDeadline: Date.now() + 60_000, uploadVerifier: createHash('sha256').update(token).digest('hex') }
  const bucket = {
    async get(name) {
      return name === `shares/${id}/status.json`
        ? { size: 200, text: async () => JSON.stringify(status) } : null
    },
    async head(name) { return objects.has(name) ? { size: objects.get(name).length } : null },
    async put(name, stream, options) {
      const chunks = []
      for await (const chunk of stream) chunks.push(chunk)
      if (options.onlyIf.get('If-None-Match') === '*' && objects.has(name)) return null
      objects.set(name, Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))
      return { size: objects.get(name).length }
    },
    async delete(name) { objects.delete(name) },
  }
  const env = { BOARD_SHARE_ALLOWED_ORIGIN: origin, BOARD_SHARES: bucket }
  const upload = (bytes, authorization = token) => worker.fetch(new Request(`https://upload.example.test/upload/${id}`, {
    method: 'PUT', headers: { Origin: origin, Authorization: `Bearer ${authorization}`, 'Content-Type': 'application/zip' }, body: bytes,
  }), env)
  return { objects, status, env, upload }
}

test('bounded Worker stores a valid upload once and rejects replay', async () => {
  const { objects, upload } = fixture()
  assert.equal((await upload(body)).status, 200)
  assert.deepEqual(objects.get(key), Buffer.from(body))
  assert.equal((await upload(body)).status, 412)
  assert.deepEqual(objects.get(key), Buffer.from(body))
})

test('bounded Worker rejects an extra byte before R2 stores an object', async () => {
  const { objects, upload } = fixture()
  assert.equal((await upload(new Uint8Array(body.length + 1))).status, 413)
  assert.equal(objects.has(key), false)
})

test('bounded Worker rejects a late extra chunk even with a misleading length header', async () => {
  const { objects, env } = fixture()
  let step = 0
  const stream = new ReadableStream({ pull(controller) {
    controller.enqueue(step++ === 0 ? body : new Uint8Array([8]))
    if (step === 2) controller.close()
  } })
  const request = new Request(`https://upload.example.test/upload/${id}`, { method: 'PUT', duplex: 'half',
    headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/zip', 'Content-Length': String(body.length) },
    body: stream,
  })
  assert.equal((await worker.fetch(request, env)).status, 413)
  assert.equal(objects.has(key), false)
})

test('an early conditional-write conflict does not leave the upload hanging', async () => {
  const { env, upload } = fixture()
  env.BOARD_SHARES.put = async () => null
  const response = await Promise.race([upload(body), new Promise((_, reject) => setTimeout(() => reject(new Error('Upload hung.')), 1000))])
  assert.equal(response.status, 412)
})

test('bounded Worker requires token, pending state, origin and deadline', async () => {
  const { objects, status, env, upload } = fixture()
  assert.equal((await upload(body, 'd'.repeat(64))).status, 403)
  status.status = 'ready'
  assert.equal((await upload(body)).status, 403)
  status.status = 'pending'
  status.uploadDeadline = Date.now() - 1
  assert.equal((await upload(body)).status, 403)
  assert.equal(objects.has(key), false)
  const wrongOrigin = new Request(`https://upload.example.test/upload/${id}`, {
    method: 'PUT', headers: { Origin: 'https://other.test', Authorization: `Bearer ${token}`, 'Content-Type': 'application/zip' }, body,
  })
  assert.equal((await worker.fetch(wrongOrigin, env)).status, 403)
})
