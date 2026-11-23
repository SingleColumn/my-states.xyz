import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import { cameraZoom, centerOf, chooseBoardMenuItem, createBoardFromToolbar, describeCanvas, dispatch, expectCanvasSaved, openApp, panelOfType, readStorage, shapeOf, titleOf, waitForCanvas } from './helpers'

const portable = (panels: Awaited<ReturnType<typeof describeCanvas>>['panels']) =>
  panels.map(({ type, x, y, w, h, order, visible, config, note }) => {
    const { activeNoteId: _id, ...rest } = config as Record<string, unknown>
    return { type, x, y, w, h, order, visible, config: rest, note: note && { title: note.title, content: note.content } }
  })

async function assets(page: Page, boardId: string) {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('my-states')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const all = await new Promise<Array<{ boardId: string; filename: string; blob: Blob }>>((resolve, reject) => {
      const request = db.transaction('assets').objectStore('assets').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return Promise.all(all.filter((asset) => asset.boardId === id).map(async (asset) => ({
      filename: asset.filename, bytes: Array.from(new Uint8Array(await asset.blob.arrayBuffer())),
    })))
  }, boardId)
}

test('reference board survives an independent browser import and recipient edit', async ({ page, browser }, testInfo) => {
  await openApp(page)
  await createBoardFromToolbar(page, 'Sharing reference')
  const sourceId = (await describeCanvas(page)).board!.id
  const notes = await panelOfType(page, 'notes')
  const images = await panelOfType(page, 'slideshow')
  const music = await panelOfType(page, 'spotify')
  await dispatch(page, { kind: 'note.setTitle', panelId: notes.panelId, title: 'Field notes' })
  await dispatch(page, { kind: 'note.setContent', panelId: notes.panelId, content: '# Archive check\n\n**Bold memory** and a list:\n- blue\n- gold' })
  await dispatch(page, { kind: 'appearance.setBoardTheme', themeId: 'terminal' })
  await dispatch(page, { kind: 'panel.update', panelId: music.panelId, config: { playlist: {
    id: 'reference-playlist', uri: 'spotify:playlist:reference-playlist',
    name: 'Reference playlist', url: 'https://open.spotify.com/playlist/reference-playlist',
  } } })
  await dispatch(page, { kind: 'panel.move', panelId: notes.panelId, x: -90, y: 145 })
  await dispatch(page, { kind: 'panel.move', panelId: images.panelId, x: 110, y: 35 })
  await dispatch(page, { kind: 'panel.resize', panelId: notes.panelId, w: 620, h: 560 })
  await dispatch(page, { kind: 'panel.resize', panelId: images.panelId, w: 530, h: 610 })
  await dispatch(page, { kind: 'panel.resize', panelId: music.panelId, w: 440, h: 500 })
  await dispatch(page, { kind: 'panel.bringToFront', panelId: notes.panelId })
  await (await shapeOf(page, images.panelId)).locator('input.visually-hidden-file-input').setInputFiles('browser-tests/fixtures/picture-folder')
  await expect.poll(async () => (await panelOfType(page, 'slideshow')).config).toMatchObject({ imageSource: { type: 'session-assets' } })
  await expect((await shapeOf(page, images.panelId)).locator('img.slideshow-image-layer')).toBeVisible()
  const { x, y } = await centerOf(await titleOf(page, notes.panelId))
  await page.mouse.move(x, y - 60)
  await page.mouse.wheel(120, 75)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -240)
  await page.keyboard.up('Control')
  await expect.poll(() => cameraZoom(page)).not.toBe(1)
  await expectCanvasSaved(page)
  await expect.poll(async () => (await readStorage(page, sourceId)).notes[0]?.content).toContain('**Bold memory**')
  await expect.poll(async () => Math.abs(((await readStorage(page, sourceId)).camera?.z ?? 0) - await cameraZoom(page))).toBeLessThan(0.0001)
  // Wheel zoom and the debounced camera save can finish after the first non-default reading.
  await page.waitForTimeout(700)
  const source = await describeCanvas(page)
  const sourceStored = await readStorage(page, sourceId)
  const sourceAssets = await assets(page, sourceId)
  expect(sourceAssets.length).toBeGreaterThan(0)
  expect(source.theme).toMatchObject({ id: 'terminal', source: 'board' })

  const downloadPromise = page.waitForEvent('download')
  const exportStart = Date.now()
  await chooseBoardMenuItem(page, 'Export board')
  const download = await downloadPromise
  const exportMs = Date.now() - exportStart
  const archivePath = testInfo.outputPath(download.suggestedFilename())
  await download.saveAs(archivePath)
  const archiveBytes = new Uint8Array(await readFile(archivePath))
  const archiveSize = archiveBytes.byteLength
  const entries = unzipSync(archiveBytes)
  const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']))
  expect(manifest.formatVersion).toBe(3)
  expect(manifest.images.length).toBeGreaterThan(0)

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  try {
    const recipient = await context.newPage()
    await openApp(recipient)
    expect((await describeCanvas(recipient)).board?.name).toBe('A new board')
    const importStart = Date.now()
    await recipient.locator('.board-toolbar input[type="file"]').setInputFiles(archivePath)
    await expect.poll(async () => (await describeCanvas(recipient)).board?.name).toBe('Sharing reference')
    await waitForCanvas(recipient)
    const importMs = Date.now() - importStart
    const imported = await describeCanvas(recipient)
    const importedId = imported.board!.id
    expect(importedId).not.toBe(sourceId)
    expect(imported.theme).toMatchObject({ id: 'terminal', source: 'board' })
    expect(portable(imported.panels)).toEqual(portable(source.panels))
    const importedStored = await readStorage(recipient, importedId)
    expect(importedStored.camera).toMatchObject({
      x: sourceStored.camera?.x, y: sourceStored.camera?.y, z: sourceStored.camera?.z,
    })
    expect(await assets(recipient, importedId)).toEqual(sourceAssets)
    await expect((await shapeOf(recipient, (await panelOfType(recipient, 'slideshow')).panelId)).locator('img.slideshow-image-layer')).toBeVisible()
    const importedNotes = await panelOfType(recipient, 'notes')
    await dispatch(recipient, { kind: 'note.setContent', panelId: importedNotes.panelId, content: '# Recipient edit\n\n**Only here**' })
    await expect.poll(async () => (await readStorage(recipient, importedId)).notes[0]?.content).toContain('Only here')
    expect((await readStorage(page, sourceId)).notes[0]?.content).toContain('Bold memory')
    await recipient.reload()
    await waitForCanvas(recipient)
    expect((await describeCanvas(recipient)).board?.id).toBe(importedId)
    expect((await readStorage(recipient, importedId)).notes[0]?.content).toContain('Only here')
    console.log(JSON.stringify({ archiveSize, exportMs, importMs, imageCount: sourceAssets.length,
      camera: importedStored.camera, panelCount: imported.panels.length }))
  } finally {
    await context.close()
  }
})
