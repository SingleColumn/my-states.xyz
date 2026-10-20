import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'
import { cameraTransform, createBoardFromToolbar, describeCanvas, dragFrom, dragLocator, expectCanvasSaved, noteBodyOf, openApp, panelOfType, selectPanel, shapeOf, switchBoard, waitForCanvas } from './helpers'

const aiCalls = new WeakMap<Page, { count: number }>()
const associations: Record<string, Array<{ word: string; relationship: string }>> = {
  dark: [
    { word: 'night', relationship: 'semantic' }, { word: 'fear', relationship: 'emotional' },
    { word: 'mystery', relationship: 'conceptual' }, { word: 'shadow', relationship: 'sensory' },
    { word: 'unknown', relationship: 'symbolic' }, { word: 'light', relationship: 'opposite' },
  ],
  night: [
    { word: 'silence', relationship: 'sensory' }, { word: 'dreams', relationship: 'conceptual' },
    { word: 'day', relationship: 'opposite' },
  ],
  fear: [{ word: 'danger', relationship: 'conceptual' }, { word: 'anxiety', relationship: 'emotional' }],
  mystery: [{ word: 'secret', relationship: 'semantic' }],
  shadow: [{ word: 'silhouette', relationship: 'sensory' }],
  light: [{ word: 'hope', relationship: 'symbolic' }],
}

test.beforeEach(async ({ page }) => {
  const calls = { count: 0 }
  aiCalls.set(page, calls)
  await page.addInitScript(() => localStorage.setItem('my-states:openai-key', 'sk-test-word-graph-browser-1234567890'))
  await page.route('**/api/ai', async route => {
    calls.count += 1
    const body = route.request().postDataJSON() as { operation: string; word?: string; input?: string[] }
    if (body.operation === 'embeddings') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ embeddings: (body.input ?? []).map(() => [1, 0, 0]) }) })
      return
    }
    const candidates = associations[body.word?.toLocaleLowerCase() ?? ''] ?? [{ word: 'night', relationship: 'semantic' }]
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates }) })
  })
})

async function readStoredWordGraph(page: Page, boardId: string) {
  return page.evaluate(async id => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('my-states-word-graphs')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const value = await new Promise<any>((resolve, reject) => {
      const request = database.transaction('graphs').objectStore('graphs').get(id)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    database.close()
    return value
  }, boardId)
}

async function selectAndOpen(page: Page, word = 'dark') {
  const notes = await panelOfType(page, 'notes')
  const body = noteBodyOf(await shapeOf(page, notes.panelId))
  await body.fill(word)
  await body.press('Control+a')
  const p = await page.evaluate(() => {
    const r = getSelection()!.getRangeAt(0).getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await page.mouse.click(p.x, p.y, { button: 'right' })
  await page.getByRole('button', { name: 'Explore associations' }).click()
  const dialog = page.getByRole('dialog', { name: 'Word Graph', exact: true })
  await expect(dialog).toBeVisible()
  return { dialog, body }
}
const node = (page: Page, word: string) => page.locator(`.word-graph-svg [data-node-id="word:${word}"]`)

test('selected Unicode word opens outside the canvas without altering notes or shapes; a new request replaces it', async ({ page }) => {
  await openApp(page)
  const before = await describeCanvas(page)
  const { dialog, body } = await selectAndOpen(page, '\u00c9t\u00e9')
  await expect(node(page, '\u00e9t\u00e9')).toBeVisible()
  expect(await dialog.evaluate(el => el.parentElement === document.body)).toBe(true)
  expect((await describeCanvas(page)).panels.map(({ note, ...shape }) => shape)).toEqual(before.panels.map(({ note, ...shape }) => shape))
  await expect(body).toHaveText('\u00c9t\u00e9')
  // Move the window away from the editor to ask for another word.
  await dragLocator(page, page.getByTestId('word-graph-drag'), { dx: 650, dy: 200 })
  await selectAndOpen(page, 'night')
  await expect(page.locator('.word-graph-window')).toHaveCount(1)
  await expect(node(page, 'night')).toBeVisible()
  await expect(dialog).toContainText('Sample associations')
  await page.screenshot({ path: test.info().outputPath('word-graph.png') })
})

test('invalid multi-word selection leaves the contextual action disabled', async ({ page }) => {
  await openApp(page)
  const body = noteBodyOf(await shapeOf(page, (await panelOfType(page, 'notes')).panelId))
  await body.fill('two words')
  await body.press('Control+a')
  const p = await body.boundingBox()
  await page.mouse.click(p!.x + 30, p!.y + 12, { button: 'right' })
  await expect(page.getByRole('button', { name: 'Explore associations' })).toBeDisabled()
})

test('header drag, resize, maximize and restore preserve graph and canvas', async ({ page }) => {
  await openApp(page)
  const { dialog } = await selectAndOpen(page)
  const camera = await cameraTransform(page), canvas = (await describeCanvas(page)).panels
  await node(page, 'night').click()
  const a = (await dialog.boundingBox())!
  await dragLocator(page, page.getByTestId('word-graph-drag'), { dx: 70, dy: 45 })
  const b = (await dialog.boundingBox())!
  expect(b.x).toBeCloseTo(a.x + 70, 0)
  expect(b.y).toBeCloseTo(a.y + 45, 0)
  await dragLocator(page, dialog.getByRole('separator', { name: 'Resize Word Graph' }), { dx: 80, dy: 45 })
  const resized = (await dialog.boundingBox())!
  expect(resized.width).toBeGreaterThan(b.width)
  expect(resized.height).toBeGreaterThan(b.height)
  const transform = await page.getByTestId('graph-viewport').getAttribute('transform')
  await dialog.getByRole('button', { name: 'Maximize Word Graph' }).click()
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(resized.width)
  await expect(dialog.getByRole('separator')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Restore Word Graph' }).click()
  expect(await dialog.boundingBox()).toEqual(resized)
  await expect(node(page, 'dreams')).toBeVisible()
  await expect(page.getByTestId('graph-viewport')).toHaveAttribute('transform', transform!)
  await dragLocator(page, page.getByTestId('word-graph-drag'), { dx: -30, dy: -20 })
  expect((await dialog.boundingBox())!.x).toBeLessThan(resized.x)
  expect(await cameraTransform(page)).toBe(camera)
  expect((await describeCanvas(page)).panels).toEqual(canvas)
})

test('node drag, empty-space pan and ordinary / Ctrl / Cmd wheel remain isolated', async ({ page }) => {
  await openApp(page)
  const { dialog } = await selectAndOpen(page)
  const camera = await cameraTransform(page), box = await dialog.boundingBox()
  const before = await node(page, 'night').getAttribute('transform')
  await dragLocator(page, node(page, 'night'), { dx: 35, dy: 20 })
  expect(await node(page, 'night').getAttribute('transform')).not.toBe(before)
  await expect(node(page, 'dreams')).toHaveCount(0)
  const svg = page.locator('.word-graph-svg'), area = (await svg.boundingBox())!
  const view = page.getByTestId('graph-viewport'), start = await view.getAttribute('transform')
  await dragFrom(page, { x: area.x + 20, y: area.y + 20 }, { dx: 40, dy: 20 })
  expect(await view.getAttribute('transform')).not.toBe(start)
  for (const modifier of [null, 'Control', 'Meta'] as const) {
    const zoom = await svg.getAttribute('data-zoom')
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2)
    if (modifier) await page.keyboard.down(modifier)
    await page.mouse.wheel(0, -80)
    if (modifier) await page.keyboard.up(modifier)
    await expect(svg).not.toHaveAttribute('data-zoom', zoom!)
    expect(await cameraTransform(page)).toBe(camera)
  }
  expect(await dialog.boundingBox()).toEqual(box)
})

test('expansion, collapse and filtering preserve expansion and keep the root', async ({ page }) => {
  await openApp(page)
  const { dialog } = await selectAndOpen(page)
  await expect(node(page, 'dreams')).toHaveCount(0)
  await node(page, 'night').click()
  await expect(node(page, 'dreams')).toBeVisible()
  await node(page, 'night').click()
  await expect(node(page, 'dreams')).toHaveCount(0)
  await node(page, 'night').focus()
  await page.keyboard.press('Enter')
  await expect(node(page, 'dreams')).toBeVisible()
  await dialog.getByRole('checkbox', { name: 'semantic', exact: true }).uncheck()
  await expect(page.locator('.word-graph-svg [data-relationship="semantic"]')).toHaveCount(0)
  await expect(node(page, 'night')).toHaveCount(0)
  await expect(node(page, 'dreams')).toHaveCount(0)
  await dialog.getByRole('checkbox', { name: 'semantic', exact: true }).check()
  await expect(node(page, 'dreams')).toBeVisible()
  for (const checkbox of await dialog.getByRole('checkbox').all()) await checkbox.uncheck()
  await expect(page.locator('.word-graph-svg [data-node-id]')).toHaveCount(1)
  await expect(node(page, 'dark')).toBeVisible()
})

test('Delete/Backspace protect selected panels, Escape closes, editor typing and canvas shortcuts resume', async ({ page }) => {
  await openApp(page)
  const images = await panelOfType(page, 'slideshow')
  const { dialog, body } = await selectAndOpen(page)
  // Selecting outside the window is still normal canvas input.
  await selectPanel(page, images.panelId)
  const panels = (await describeCanvas(page)).panels
  await page.getByTestId('word-graph-drag').click()
  await page.keyboard.press('Delete')
  await page.keyboard.press('Backspace')
  const shapeCount = await page.locator('.tl-shape').count()
  for (const shortcut of ['Control+d', 'Control+x', 'Control+v']) {
    await expect(dialog).toBeFocused()
    await page.keyboard.press(shortcut)
    expect((await describeCanvas(page)).panels).toEqual(panels)
    await expect(body).toHaveText('dark')
    await expect(page.locator('.tl-shape')).toHaveCount(shapeCount)
  }
  expect((await describeCanvas(page)).panels).toEqual(panels)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(body).toBeFocused()
  await expect(body).toHaveText('dark')
  await body.press('ArrowRight')
  await body.press('End')
  await page.keyboard.type(' night')
  await expect(body).toHaveText('dark night')
  await selectPanel(page, images.panelId)
  await page.locator('.tl-container').focus()
  await page.keyboard.press('Delete')
  await expect.poll(async () => (await describeCanvas(page)).panels.length).toBe(panels.length - 1)
})

test('a higher-priority Settings dialog owns Escape; close button then discards the graph', async ({ page }) => {
  await openApp(page)
  const { dialog } = await selectAndOpen(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await expect(settings).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Close Word Graph' }).click()
  await expect(dialog).toHaveCount(0)
})

test('recovery stays outside board archives and remains scoped while switching boards', async ({ page }, info) => {
  await openApp(page)
  await selectAndOpen(page)
  await expectCanvasSaved(page)
  const originalBoard = (await describeCanvas(page)).board!
  const original = (await describeCanvas(page)).panels
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export board' }).click()
  const download = await downloading
  const path = info.outputPath('word-graph.board.zip')
  await download.saveAs(path)
  const archive = unzipSync(new Uint8Array(await readFile(path)))
  for (const [name, bytes] of Object.entries(archive)) {
    if (name.endsWith('.json')) expect(strFromU8(bytes)).not.toMatch(/wordGraph|word-graph|sampleAssociations|expandedNodes/)
  }
  await page.reload()
  await waitForCanvas(page)
  await expect(page.locator('.word-graph-window')).toHaveCount(1)
  await expect(node(page, 'dark')).toBeVisible()
  expect((await describeCanvas(page)).panels).toEqual(original)
  await createBoardFromToolbar(page, 'Another board')
  await expect(page.locator('.word-graph-window')).toHaveCount(0)
  await switchBoard(page, originalBoard.name)
  await expect(page.locator('.word-graph-window')).toHaveCount(1)
  await switchBoard(page, 'Another board')
  await expect(page.locator('.word-graph-window')).toHaveCount(0)
  page.once('dialog', dialog => void dialog.accept('Imported board'))
  await page.locator('.board-toolbar input[type="file"]').setInputFiles(path)
  await expect.poll(async () => (await describeCanvas(page)).board?.name).toBe('Imported board')
  await expect(page.locator('.word-graph-window')).toHaveCount(0)
})

test('graph exploration and floating-window state survive reload without another OpenAI request', async ({ page }) => {
  await openApp(page)
  const boardId = (await describeCanvas(page)).board!.id
  const { dialog } = await selectAndOpen(page)
  await expect(node(page, 'night')).toBeVisible()

  await dragLocator(page, node(page, 'night'), { dx: 38, dy: 24 })
  await node(page, 'night').click()
  await expect(node(page, 'dreams')).toBeVisible()
  await dialog.getByRole('checkbox', { name: 'emotional', exact: true }).uncheck()
  const svg = page.locator('.word-graph-svg')
  const area = (await svg.boundingBox())!
  await dragFrom(page, { x: area.x + 18, y: area.y + 18 }, { dx: 46, dy: 28 })
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2)
  await page.mouse.wheel(0, -90)
  await dragLocator(page, page.getByTestId('word-graph-drag'), { dx: 75, dy: 48 })
  await dragLocator(page, dialog.getByRole('separator', { name: 'Resize Word Graph' }), { dx: 64, dy: 36 })

  const restoreBox = (await dialog.boundingBox())!
  const nodeTransform = await node(page, 'night').getAttribute('transform')
  const viewportTransform = await page.getByTestId('graph-viewport').getAttribute('transform')
  await dialog.getByRole('button', { name: 'Maximize Word Graph' }).click()
  await expect(dialog.getByRole('button', { name: 'Restore Word Graph' })).toBeVisible()
  await expect.poll(async () => (await readStoredWordGraph(page, boardId))?.presentation).toMatchObject({
    expandedNodeIds: expect.arrayContaining(['word:dark', 'word:night']),
    enabledRelationshipTypes: expect.not.arrayContaining(['emotional']),
    window: expect.objectContaining({ maximized: true }),
  })

  const requestsBeforeReload = aiCalls.get(page)!.count
  await page.reload()
  await waitForCanvas(page)
  const restored = page.getByRole('dialog', { name: 'Word Graph', exact: true })
  await expect(restored).toBeVisible()
  await expect(node(page, 'dreams')).toBeVisible()
  await expect(node(page, 'night')).toHaveAttribute('transform', nodeTransform!)
  await expect(page.getByTestId('graph-viewport')).toHaveAttribute('transform', viewportTransform!)
  await expect(restored.getByRole('checkbox', { name: 'emotional', exact: true })).not.toBeChecked()
  await expect(restored.getByRole('button', { name: 'Restore Word Graph' })).toBeVisible()
  expect(aiCalls.get(page)!.count).toBe(requestsBeforeReload)

  await restored.getByRole('button', { name: 'Restore Word Graph' }).click()
  const restoredBox = (await restored.boundingBox())!
  expect(restoredBox.x).toBeCloseTo(restoreBox.x, 0)
  expect(restoredBox.y).toBeCloseTo(restoreBox.y, 0)
  expect(restoredBox.width).toBeCloseTo(restoreBox.width, 0)
  expect(restoredBox.height).toBeCloseTo(restoreBox.height, 0)

  await restored.getByRole('button', { name: 'Close Word Graph' }).click()
  await expect.poll(async () => (await readStoredWordGraph(page, boardId))?.presentation.isOpen).toBe(false)
  await page.reload()
  await waitForCanvas(page)
  await expect(page.getByRole('dialog', { name: 'Word Graph', exact: true })).toHaveCount(0)
  expect(aiCalls.get(page)!.count).toBe(requestsBeforeReload)
})


test('viewport shrink clamps geometry and continued writing never steals focus', async ({ page }) => {
  await openApp(page)
  const { dialog, body } = await selectAndOpen(page)
  await dragLocator(page, page.getByTestId('word-graph-drag'), { dx: 650, dy: 250 })
  await body.click({ position: { x: 15, y: 15 } })
  await body.press('End')
  await page.keyboard.type(' continued writing')
  await expect(body).toHaveText('dark continued writing')
  await expect(body).toBeFocused()
  // A graph node takes keyboard ownership back from the editor.
  await node(page, 'night').click()
  await page.keyboard.press('Backspace')
  await expect(body).toHaveText('dark continued writing')
  await page.setViewportSize({ width: 620, height: 480 })
  const box = (await dialog.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(620)
  expect(box.y + box.height).toBeLessThanOrEqual(480)
  await dialog.getByRole('button', { name: 'Close Word Graph' }).click()
  const camera = await cameraTransform(page)
  await page.mouse.move(600, 450)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -120)
  await page.keyboard.up('Control')
  await expect.poll(() => cameraTransform(page)).not.toBe(camera)
})


test('a single word selected inside a sentence captures the word without editing the sentence', async ({ page }) => {
  await openApp(page)
  const body = noteBodyOf(await shapeOf(page, (await panelOfType(page, 'notes')).panelId))
  await body.fill('A dark night')
  await body.press('ArrowRight')
  await body.press('End')
  await body.press('Control+ArrowLeft')
  await body.press('ArrowLeft')
  await body.press('Shift+Control+ArrowLeft')
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('dark')
  const p = await page.evaluate(() => {
    const r = getSelection()!.getRangeAt(0).getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  const count = await page.locator('.tl-shape').count()
  await page.mouse.click(p.x, p.y, { button: 'right' })
  await page.getByRole('button', { name: 'Explore associations' }).click()
  await expect(node(page, 'dark')).toBeVisible()
  await expect(body).toHaveText('A dark night')
  await expect(page.locator('.tl-shape')).toHaveCount(count)
})
