import { test, expect, type Page } from '@playwright/test'
import {
  addPanelFromToolbar,
  cameraTransform,
  cameraZoom,
  centerOf,
  clickAt,
  createBoardFromToolbar,
  describeCanvas,
  dispatch,
  dragLocator,
  expectArchitectureReportPass,
  expectCanvasSaved,
  geometryOf,
  loadSampleImages,
  boardPicker,
  boardPickerNames,
  chooseBoardMenuItem,
  noteBodyOf,
  openApp,
  panelById,
  panelOfType,
  readStorage,
  selectPanel,
  shapeOf,
  switchBoard,
  titleOf,
  waitForCanvas,
  type PanelDescription,
} from './helpers'

/**
 * The board lifecycle, as the save-safety checklist that used to be run by
 * hand before each release: what a fresh profile opens with, what survives
 * a reload, what an export carries and an import brings back, and what the
 * page does when it is being left or asked for two things at once.
 */

/**
 * Everything about a panel that must survive a reload or an export/import
 * round trip, minus identities: panel ids are kept by both, but an import
 * gives notes new ids (and remaps the panel's `activeNoteId` to match), so
 * the note is compared by what it says.
 */
function persistedShape(panel: PanelDescription) {
  const { x, y, w, h, type, visible, focusView, order, note } = panel
  const { activeNoteId: _activeNoteId, ...config } = panel.config as Record<string, unknown>
  return { type, x, y, w, h, visible, focusView, order, config, note: note ? { title: note.title, content: note.content } : note }
}

test('a fresh profile opens one board with three panels and a clean report', async ({ page }) => {
  const { pageErrors } = await openApp(page)
  const canvas = await describeCanvas(page)
  expect(canvas.board?.name).toBe('A new board')
  expect(await boardPickerNames(page)).toEqual(['A new board'])
  expect(canvas.panels.map((panel) => panel.type)).toEqual(['slideshow', 'notes', 'spotify'])
  expect(canvas.panels.every((panel) => panel.visible && !panel.focusView)).toBe(true)
  await expectArchitectureReportPass(page)
  expect(pageErrors).toEqual([])
})

test('panels, hiding, settings and stacking order survive a reload', async ({ page }) => {
  await openApp(page)
  const music = await panelOfType(page, 'spotify')
  const images = await panelOfType(page, 'slideshow')
  await loadSampleImages(page, images.panelId)

  // Add a panel and move it. A new panel lands on its type's default
  // layout, exactly on top of the Notes panel already there, so this also
  // exercises telling two co-located panels apart: the added one moves and
  // the original stays.
  const originalNotes = await panelOfType(page, 'notes')
  const added = await addPanelFromToolbar(page, 'notes')
  expect(geometryOf(added)).toEqual(geometryOf(originalNotes))
  await dragLocator(page, await titleOf(page, added.panelId), { dx: -80, dy: 140 })
  expect(geometryOf(await panelById(page, added.panelId))).not.toEqual(geometryOf(added))
  expect(geometryOf(await panelById(page, originalNotes.panelId))).toEqual(geometryOf(originalNotes))

  // Hide Music from its own context menu.
  await clickAt(page, await titleOf(page, music.panelId), { button: 'right' })
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'Hide panel' }).click()
  await expect.poll(async () => (await panelById(page, music.panelId)).visible).toBe(false)

  // Change slideshow settings through the panel's controls.
  const imagesShape = await shapeOf(page, images.panelId)
  await imagesShape.getByRole('button', { name: 'Shuffle images' }).click()
  const speed = imagesShape.locator('.range-grid label', { hasText: 'Speed' }).locator('input[type="range"]')
  await speed.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await panelById(page, images.panelId)).config).toMatchObject({ shuffle: true, intervalMs: 6500 })

  // Bring Images to the front of the stacking order (tldraw's "]").
  await selectPanel(page, images.panelId)
  await page.keyboard.press(']')
  await expect.poll(async () => (await panelById(page, images.panelId)).order).toBe(3)

  // The report checks that every shape is persisted, not that its latest
  // props are; the save itself is debounced, so wait for it to land.
  await expectArchitectureReportPass(page)
  await expectCanvasSaved(page)
  const before = (await describeCanvas(page)).panels
  expect(before).toHaveLength(4)

  await page.reload()
  await waitForCanvas(page)
  await expect.poll(async () => (await describeCanvas(page)).panels.length).toBe(4)
  const after = (await describeCanvas(page)).panels
  expect(after.map((panel) => ({ panelId: panel.panelId, ...persistedShape(panel) })))
    .toEqual(before.map((panel) => ({ panelId: panel.panelId, ...persistedShape(panel) })))
  expect(after.find((panel) => panel.panelId === music.panelId)?.visible).toBe(false)
  await expectArchitectureReportPass(page)
})

test('the camera survives a reload after a pan and a zoom', async ({ page }) => {
  await openApp(page)
  const boardId = (await describeCanvas(page)).board?.id ?? ''
  await expectCanvasSaved(page)
  const before = (await readStorage(page, boardId)).camera
  const notes = await panelOfType(page, 'notes')
  // Over the canvas itself, just above a panel: a wheel pans, Ctrl+wheel zooms.
  const { x, y } = await centerOf(await titleOf(page, notes.panelId))
  await page.mouse.move(x, y - 60)
  await page.mouse.wheel(140, 90)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -300)
  await page.keyboard.up('Control')
  const onScreen = await cameraTransform(page)
  // The layer's translate carries a sub-pixel offset of tldraw's, so only
  // the zoom is compared directly with what storage holds.
  const zoom = await cameraZoom(page)
  await expect.poll(async () => (await readStorage(page, boardId)).camera, { message: 'the pan and zoom reach storage' }).not.toEqual(before)
  await expect.poll(async () => Math.abs(((await readStorage(page, boardId)).camera?.z ?? 0) - zoom), { message: 'the stored zoom is the one on screen' }).toBeLessThan(0.0001)
  // The pan and the zoom were separate saves; wait out the debounce so the
  // reload cannot land between them.
  await page.waitForTimeout(600)
  await page.reload()
  await waitForCanvas(page)
  await expect.poll(() => cameraTransform(page)).toBe(onScreen)
})

test('hovering and selecting a panel do not write the board again', async ({ page }) => {
  await openApp(page)
  const boardId = (await describeCanvas(page)).board?.id ?? ''
  await expectCanvasSaved(page)
  // Let any save still in flight from opening land before taking the mark.
  await page.waitForTimeout(800)
  const { updatedAt } = await readStorage(page, boardId)
  const notes = await panelOfType(page, 'notes')
  const images = await panelOfType(page, 'slideshow')
  for (const panelId of [images.panelId, notes.panelId]) {
    const { x, y } = await centerOf(await titleOf(page, panelId))
    await page.mouse.move(x, y, { steps: 4 })
  }
  await selectPanel(page, notes.panelId)
  await page.keyboard.press('Escape')
  // Longer than the 300ms debounce, so a scheduled save would have landed.
  await page.waitForTimeout(1000)
  expect((await readStorage(page, boardId)).updatedAt).toBe(updatedAt)
})

test('export writes a .board.zip and import brings the board back, listed in the picker at once', async ({ page }, testInfo) => {
  await openApp(page)
  const source = (await describeCanvas(page)).board
  if (!source) throw new Error('No board is open')

  // Something worth carrying: a note, a moved panel, a hidden one.
  const notes = await panelOfType(page, 'notes')
  await noteBodyOf(await shapeOf(page, notes.panelId)).click()
  await page.keyboard.type('Packed for travel.')
  await expect.poll(async () => (await panelById(page, notes.panelId)).note?.content).toContain('Packed for travel.')
  await dragLocator(page, await titleOf(page, notes.panelId), { dx: -100, dy: 90 })
  const music = await panelOfType(page, 'spotify')
  await clickAt(page, await titleOf(page, music.panelId), { button: 'right' })
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'Hide panel' }).click()
  await expect.poll(async () => (await panelById(page, music.panelId)).visible).toBe(false)
  await expectArchitectureReportPass(page)
  const exported = (await describeCanvas(page)).panels.map(persistedShape)

  const downloading = page.waitForEvent('download')
  await chooseBoardMenuItem(page, 'Export board')
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/\.board\.zip$/)
  const archivePath = testInfo.outputPath(download.suggestedFilename())
  await download.saveAs(archivePath)

  // A board named exactly like the source is already open, so re-importing
  // this file offers a new name; typing the original name back is how a
  // genuine same-named duplicate -- what this round trip is testing -- is
  // still produced deliberately.
  page.once('dialog', (dialog) => void dialog.accept(source.name))
  await page.locator('.board-toolbar input[type="file"]').setInputFiles(archivePath)
  await expect.poll(async () => (await describeCanvas(page)).board?.id).not.toBe(source.id)
  const imported = (await describeCanvas(page)).board
  if (!imported) throw new Error('No board is open after the import')
  expect(imported.name).toBe(source.name)

  // The picker lists the imported board straight away, and has it selected.
  // (A regression here once left it out until the next create or delete.)
  await expect(boardPicker(page)).toHaveValue(imported.id)
  const listed = await boardPicker(page).locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))
  expect(listed.sort()).toEqual([source.id, imported.id].sort())
  expect(await boardPickerNames(page)).toEqual([source.name, source.name])

  await waitForCanvas(page)
  await expect.poll(async () => (await describeCanvas(page)).panels.map(persistedShape)).toEqual(exported)
  await expectArchitectureReportPass(page)
})

test('Duplicate board makes an independent, already-open copy named "(copy)", never asking', async ({ page }) => {
  await openApp(page)
  const source = (await describeCanvas(page)).board
  if (!source) throw new Error('No board is open')
  const sourcePanels = (await describeCanvas(page)).panels.map(persistedShape)

  await chooseBoardMenuItem(page, 'Duplicate board')
  await expect.poll(async () => (await describeCanvas(page)).board?.id).not.toBe(source.id)
  const duplicate = (await describeCanvas(page)).board
  if (!duplicate) throw new Error('No board is open after duplicating')
  expect(duplicate.name).toBe(`${source.name} (copy)`)
  expect((await describeCanvas(page)).panels.map(persistedShape)).toEqual(sourcePanels)
  expect((await boardPickerNames(page)).sort()).toEqual([source.name, duplicate.name].sort())
  await expectArchitectureReportPass(page)
})

test('importing an archive whose name collides with an existing board offers a new name, suggesting one free', async ({ page }, testInfo) => {
  await openApp(page)
  await createBoardFromToolbar(page, 'Kept aside')

  const downloading = page.waitForEvent('download')
  await chooseBoardMenuItem(page, 'Export board')
  const download = await downloading
  const archivePath = testInfo.outputPath(download.suggestedFilename())
  await download.saveAs(archivePath)

  // Switch away, so the collision is with a board other than the one open
  // -- the warning is not limited to re-importing the currently open board.
  await switchBoard(page, 'A new board')

  page.once('dialog', (dialog) => {
    expect(dialog.type()).toBe('prompt')
    expect(dialog.message()).toContain('"Kept aside"')
    expect(dialog.defaultValue()).toBe('Kept aside (copy)')
    void dialog.accept('Kept aside, imported')
  })
  await page.locator('.board-toolbar input[type="file"]').setInputFiles(archivePath)

  // The import is opened under the chosen name, not the colliding one --
  // the picker never carries two boards with the same name for this.
  await expect.poll(async () => (await describeCanvas(page)).board?.name).toBe('Kept aside, imported')
  const names = await boardPickerNames(page)
  expect(names.sort()).toEqual(['A new board', 'Kept aside', 'Kept aside, imported'].sort())
  expect(new Set(names).size).toBe(names.length)
  await expectArchitectureReportPass(page)
})

// A board exported without being renamed carries the starter name every
// fresh browser also has. The file is what the person named, so the prompt
// offers that.
test('a colliding import from a renamed file suggests the file\'s name', async ({ page }, testInfo) => {
  await openApp(page)

  const downloading = page.waitForEvent('download')
  await chooseBoardMenuItem(page, 'Export board')
  const download = await downloading
  const archivePath = testInfo.outputPath('both-sides-now.board.zip')
  await download.saveAs(archivePath)

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('"A new board"')
    expect(dialog.defaultValue()).toBe('both-sides-now')
    void dialog.accept(dialog.defaultValue())
  })
  await page.locator('.board-toolbar input[type="file"]').setInputFiles(archivePath)

  await expect.poll(async () => (await describeCanvas(page)).board?.name).toBe('both-sides-now')
})

test('declining the rename-or-import prompt for a colliding name adds nothing', async ({ page }, testInfo) => {
  await openApp(page)
  await createBoardFromToolbar(page, 'Kept aside')

  const downloading = page.waitForEvent('download')
  await chooseBoardMenuItem(page, 'Export board')
  const download = await downloading
  const archivePath = testInfo.outputPath(download.suggestedFilename())
  await download.saveAs(archivePath)

  await switchBoard(page, 'A new board')
  const before = await boardPickerNames(page)

  let dialogMessage = ''
  page.once('dialog', (dialog) => { dialogMessage = dialog.message(); void dialog.dismiss() })
  await page.locator('.board-toolbar input[type="file"]').setInputFiles(archivePath)
  await expect.poll(() => dialogMessage).toContain('"Kept aside"')
  // Declined: the open board and the picker are unchanged.
  await expect.poll(async () => (await describeCanvas(page)).board?.name).toBe('A new board')
  expect(await boardPickerNames(page)).toEqual(before)
})

test.describe('the flush the page runs when it is hidden or left', () => {
  /**
   * What is under test here is the flush itself: the `pagehide` and
   * `visibilitychange` handlers in App.tsx save the canvas and the notes
   * without waiting for the debounced timers. Both saves the app makes on
   * its own are on timers (a 300ms debounce for the canvas, 500ms for a
   * note), and tldraw hands store changes to its listeners on the next
   * animation frame. Freezing the page's clock takes every one of those
   * off the table, so the only way an edit can reach storage is the flush.
   *
   * What is deliberately NOT under test: a real unload. The events are
   * dispatched synthetically and the document stays alive while the
   * IndexedDB write completes. A real reload or close inside the debounce
   * window destroys the page before that write lands, and the edit is
   * lost; see the fixme below. Do not read these two tests as covering it.
   */
  async function editWithClockFrozen(page: Page) {
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    await page.clock.install()
    await page.clock.pauseAt(Date.now() + 1000)
    await page.keyboard.type('Written just before leaving.')
    await expect.poll(async () => (await panelById(page, notes.panelId)).note?.content).toContain('Written just before leaving.')
    // A canvas write while the clock is frozen: the pointer cannot drive
    // tldraw without animation frames, so this one goes through the command
    // surface. The mechanism under test is the flush, not the drag.
    await dispatch(page, { kind: 'panel.move', panelId: notes.panelId, x: notes.x - 175, y: notes.y + 125 })
    return { notes, movedTo: { x: notes.x - 175, y: notes.y + 125 } }
  }

  async function expectFlushedToStorage(page: Page, boardId: string, panelId: string, movedTo: { x: number; y: number }) {
    await expect.poll(() => readStorage(page, boardId)).toMatchObject({
      found: true,
      panels: expect.arrayContaining([expect.objectContaining({ panelId, x: movedTo.x, y: movedTo.y })]),
      notes: expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('Written just before leaving.') })]),
    })
    // And the app reads back what storage holds.
    await page.clock.resume()
    await page.reload()
    await waitForCanvas(page)
    await expect.poll(async () => (await panelById(page, panelId)).note?.content).toContain('Written just before leaving.')
    expect(geometryOf(await panelById(page, panelId))).toMatchObject(movedTo)
  }

  test('the pagehide handler writes the pending edit to storage', async ({ page }) => {
    await openApp(page)
    const boardId = (await describeCanvas(page)).board?.id ?? ''
    const { notes, movedTo } = await editWithClockFrozen(page)
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    await expectFlushedToStorage(page, boardId, notes.panelId, movedTo)
  })

  test('the tab-hidden handler writes the pending edit to storage', async ({ page }) => {
    await openApp(page)
    const boardId = (await describeCanvas(page)).board?.id ?? ''
    const { notes, movedTo } = await editWithClockFrozen(page)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expectFlushedToStorage(page, boardId, notes.panelId, movedTo)
  })

  // Known to fail (2026-09-15): probed at 0, 50 and 150ms after the edit the
  // move was never there after the reload; at 400ms it always was. The
  // pagehide flush starts an IndexedDB write that the unload does not wait
  // for. Kept as the statement of the user-facing path the two tests above
  // do not cover; turn it into a test once the app closes that window.
  test.fixme('an edit survives a real reload inside the save debounce', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    await dragLocator(page, await titleOf(page, notes.panelId), { dx: -175, dy: 125 })
    const moved = geometryOf(await panelById(page, notes.panelId))
    await page.reload()
    await waitForCanvas(page)
    expect(geometryOf(await panelById(page, notes.panelId))).toEqual(moved)
  })
})

test('a canvas command during a board switch is refused, and the switch completes', async ({ page }) => {
  await openApp(page)
  const first = (await describeCanvas(page)).board?.name ?? ''
  await createBoardFromToolbar(page, 'Second board')
  const secondLayout = (await describeCanvas(page)).panels.map(persistedShape)
  const secondNotes = await panelOfType(page, 'notes')

  // Slow the store down so the switch is observably in progress: every read
  // of a board record waits a second and a half before answering.
  await page.evaluate(() => {
    const originalGet = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, ...args: [IDBValidKey | IDBKeyRange]) {
      const request = originalGet.apply(this, args)
      if (this.name !== 'boards' || this.transaction.mode !== 'readonly') return request
      return new Promise((resolve, reject) => {
        request.onsuccess = () => setTimeout(() => resolve(request.result), 1500)
        request.onerror = () => reject(request.error)
      }) as unknown as IDBRequest
    }
  })

  await boardPicker(page).selectOption({ label: first })
  await expect(dispatch(page, { kind: 'panel.move', panelId: secondNotes.panelId, x: 0, y: 0 }))
    .rejects.toThrow('Please wait for the current board operation to finish.')

  await expect.poll(async () => (await describeCanvas(page)).board?.name, { timeout: 15_000 }).toBe(first)
  await waitForCanvas(page)
  expect((await describeCanvas(page)).panels).toHaveLength(3)
  // The refused command left the other board exactly as it was.
  await boardPicker(page).selectOption({ label: 'Second board' })
  await expect.poll(async () => (await describeCanvas(page)).board?.name, { timeout: 15_000 }).toBe('Second board')
  await waitForCanvas(page)
  expect((await describeCanvas(page)).panels.map(persistedShape)).toEqual(secondLayout)
  await expectArchitectureReportPass(page)
})
