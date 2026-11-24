import { getSharedBoardId } from './storage'

export const MAX_SHARE_ARCHIVE_BYTES = 32 * 1024 * 1024
const SHARE_ID = /^[a-f0-9]{48}$/
const SHA256 = /^[a-f0-9]{64}$/
export type ShareStage = 'preparing' | 'uploading' | 'confirming' | 'resolving' | 'receiving' | 'importing'
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

async function digest(bytes: ArrayBuffer): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

async function api<T>(action: string, method: 'GET' | 'POST', body?: unknown, id?: string): Promise<T> {
  const url = new URL('/api/boardShares', window.location.origin)
  url.searchParams.set('action', action)
  if (id) url.searchParams.set('id', id)
  const response = await fetch(url, {
    method, credentials: 'same-origin', cache: 'no-store',
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  }).catch(() => { throw new Error('The board-sharing service could not be reached. Check your connection and try again.') })
  let value: Record<string, unknown>
  try { value = await response.json() } catch { throw new Error('The sharing service returned an unreadable response.') }
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'The sharing request failed.')
  return value as T
}

export async function createSharedBoard(
  prepare: () => Promise<Blob>,
  stage: (value: ShareStage) => void,
  signal?: AbortSignal,
): Promise<{ id: string; link: string; expiresAt: number }> {
  stage('preparing')
  const archive = await prepare().catch((error: unknown) => {
    if (error instanceof TypeError) throw new Error('An online resource needed to prepare this board could not be reached.')
    throw error
  })
  if (archive.size < 1 || archive.size > MAX_SHARE_ARCHIVE_BYTES) throw new Error('This board exceeds the 32 MiB sharing limit.')
  const sha256 = await digest(await archive.arrayBuffer())
  if (signal?.aborted) throw new DOMException('Sharing was cancelled.', 'AbortError')
  const created = await api<{ id: string; url: string; headers: Record<string, string>; uploadToken: string }>('create', 'POST', {
    byteLength: archive.size, sha256,
  })
  stage('uploading')
  const upload = await fetch(created.url, {
    method: 'PUT', body: archive, headers: created.headers, signal, cache: 'no-store', redirect: 'error',
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new Error('The board could not be uploaded. Check your connection and try again.')
  })
  if (!upload.ok) throw new Error(`The board upload was rejected (error ${upload.status}). Try sharing again.`)
  stage('confirming')
  const confirmed = await api<{ id: string; link: string; expiresAt: number }>('complete', 'POST',
    { uploadToken: created.uploadToken }, created.id)
  return confirmed
}

async function boundedArchive(url: string, expectedLength: number, expectedDigest: string, signal?: AbortSignal) {
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 1 || expectedLength > MAX_SHARE_ARCHIVE_BYTES || !SHA256.test(expectedDigest)) {
    throw new Error('The shared board has invalid size or digest information.')
  }
  const response = await fetch(url, { method: 'GET', cache: 'no-store', redirect: 'error', signal })
  if (!response.ok || !response.body) throw new Error('Could not fetch this shared board. Try again.')
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_SHARE_ARCHIVE_BYTES) throw new Error('The shared board exceeds the download limit.')
  const chunks: Uint8Array[] = []
  let length = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_SHARE_ARCHIVE_BYTES || length > expectedLength) throw new Error('The shared board exceeds its declared size.')
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  if (length !== expectedLength) throw new Error('The shared board did not arrive completely.')
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  if (await digest(bytes.buffer) !== expectedDigest) throw new Error('The shared board failed its integrity check.')
  return new File([bytes], 'shared.board.zip', { type: 'application/zip' })
}

export async function receiveSharedBoard(
  id: string,
  open: (boardId: string) => Promise<void>,
  importFile: (file: File, shareId: string) => Promise<void>,
  stage: (value: ShareStage) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!SHARE_ID.test(id)) throw new Error('This share link is invalid.')
  const work = async () => {
    const localBoardId = await getSharedBoardId(id)
    if (localBoardId) { await open(localBoardId); return }
    stage('resolving')
    const { url, byteLength, sha256 } = await api<{ url: string; byteLength: number; sha256: string }>('resolve', 'GET', undefined, id)
    stage('receiving')
    const file = await boundedArchive(url, byteLength, sha256, signal)
    stage('importing')
    await importFile(file, id)
  }
  // Web Locks coordinates tabs; the unique IndexedDB mapping is the final
  // integrity guard if a browser lacks Locks or two tabs race to import.
  if (navigator.locks?.request) await navigator.locks.request(`board-share:${id}`, work)
  else await work()
}
