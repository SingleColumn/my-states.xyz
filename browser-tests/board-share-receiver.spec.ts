import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'

const id = 'a'.repeat(48)
const archive = zipSync({ 'manifest.json': strToU8(JSON.stringify({
  formatVersion: 3, board: { name: 'Received trial board', createdAt: 1, updatedAt: 2 },
  panels: [], canvas: null, notes: [], images: [],
})) })
const sha256 = createHash('sha256').update(archive).digest('hex')

async function mappings(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('my-states')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tx = db.transaction(['shareImports', 'boards'])
    const read = <T>(store: string) => new Promise<T[]>((resolve, reject) => {
      const request = tx.objectStore(store).getAll()
      request.onsuccess = () => resolve(request.result as T[])
      request.onerror = () => reject(request.error)
    })
    const [links, boards] = await Promise.all([
      read<{ shareId: string; boardId: string }>('shareImports'),
      read<{ id: string; name: string }>('boards'),
    ])
    db.close()
    return { links, boards }
  })
}

test('direct share route imports internally once across refreshes and tabs', async ({ context, page }) => {
  let resolves = 0
  let downloads = 0
  await context.route('**/api/boardShares?action=resolve*', async (route) => {
    resolves++
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      url: 'https://trial-r2.example.test/archive.board.zip', byteLength: archive.length, sha256,
    }) })
  })
  await context.route('https://trial-r2.example.test/archive.board.zip', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/zip', body: Buffer.from(archive),
      headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } })
  })
  page.on('download', () => downloads++)
  await page.goto(`/share/${id}`)
  await expect(page.getByRole('button', { name: 'Continue to board' })).toBeVisible()
  const first = await mappings(page)
  expect(first.links).toHaveLength(1)
  expect(first.boards.find((board) => board.id === first.links[0].boardId)?.name).toBe('Received trial board')
  const initialResolves = resolves
  await page.reload()
  await expect(page.getByRole('button', { name: 'Continue to board' })).toBeVisible()
  expect((await mappings(page)).links).toEqual(first.links)
  expect(resolves).toBe(initialResolves)

  const second = await context.newPage()
  second.on('download', () => downloads++)
  await second.goto(`/share/${id}`)
  await expect(second.getByRole('button', { name: 'Continue to board' })).toBeVisible()
  expect((await mappings(second)).links).toEqual(first.links)
  expect(resolves).toBe(initialResolves)
  expect(downloads).toBe(0)
})

test('simultaneous tabs converge on one imported board', async ({ context }) => {
  await context.route('**/api/boardShares?action=resolve*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      url: 'https://trial-r2.example.test/archive.board.zip', byteLength: archive.length, sha256,
    }) })
  })
  await context.route('https://trial-r2.example.test/archive.board.zip', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/zip', body: Buffer.from(archive),
      headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  const first = await context.newPage()
  const second = await context.newPage()
  await Promise.all([first.goto(`/share/${id}`), second.goto(`/share/${id}`)])
  await Promise.all([
    expect(first.getByRole('button', { name: 'Continue to board' })).toBeVisible(),
    expect(second.getByRole('button', { name: 'Continue to board' })).toBeVisible(),
  ])
  const stored = await mappings(first)
  expect(stored.links).toHaveLength(1)
  expect(stored.boards.filter((board) => board.name === 'Received trial board')).toHaveLength(1)
})

test('a missing mapped board is imported again while the share is ready', async ({ context, page }) => {
  await context.route('**/api/boardShares?action=resolve*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      url: 'https://trial-r2.example.test/archive.board.zip', byteLength: archive.length, sha256,
    }) })
  })
  await context.route('https://trial-r2.example.test/archive.board.zip', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/zip', body: Buffer.from(archive),
      headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  await page.goto(`/share/${id}`)
  await expect(page.getByRole('button', { name: 'Continue to board' })).toBeVisible()
  const firstId = (await mappings(page)).links[0].boardId
  await page.evaluate(async (boardId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('my-states')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tx = db.transaction('boards', 'readwrite')
    tx.objectStore('boards').delete(boardId)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, firstId)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Continue to board' })).toBeVisible()
  const second = await mappings(page)
  expect(second.links).toHaveLength(1)
  expect(second.links[0].boardId).not.toBe(firstId)
})

test('an imported local copy survives remote expiration; a deleted copy shows expiry', async ({ context, page }) => {
  let expired = false
  let downloads = 0
  await context.route('**/api/boardShares?action=resolve*', async (route) => {
    await route.fulfill(expired
      ? { status: 410, contentType: 'application/json', body: '{"error":"This share has expired."}' }
      : { status: 200, contentType: 'application/json', body: JSON.stringify({
        url: 'https://trial-r2.example.test/archive.board.zip', byteLength: archive.length, sha256,
      }) })
  })
  await context.route('https://trial-r2.example.test/archive.board.zip', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/zip', body: Buffer.from(archive),
      headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  page.on('download', () => downloads++)
  await page.goto(`/share/${id}`)
  await expect(page.getByRole('button', { name: 'Continue to board' })).toBeVisible()
  const boardId = (await mappings(page)).links[0].boardId
  expired = true
  await page.reload()
  await expect(page.getByRole('button', { name: 'Continue to board' })).toBeVisible()
  expect((await mappings(page)).links[0].boardId).toBe(boardId)
  await page.evaluate(async (idToDelete) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('my-states')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tx = db.transaction('boards', 'readwrite')
    tx.objectStore('boards').delete(idToDelete)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, boardId)
  await page.reload()
  await expect(page.getByRole('alert')).toHaveText('This share has expired.')
  expect(downloads).toBe(0)
})
