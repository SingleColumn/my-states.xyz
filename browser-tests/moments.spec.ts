import { test, expect, type Page } from '@playwright/test'
import {
  addPanelFromToolbar,
  clickAt,
  createMomentFromToolbar,
  describeCanvas,
  dispatch,
  dragLocator,
  expectArchitectureReportPass,
  expectCanvasSaved,
  geometryOf,
  momentPicker,
  momentPickerNames,
  noteBodyOf,
  openApp,
  panelById,
  panelOfType,
  readStorage,
  selectPanel,
  shapeOf,
  titleOf,
  waitForCanvas,
  type PanelDescription,
} from './helpers'

/**
 * The moment lifecycle, as the save-safety checklist that used to be run by
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

test('a fresh profile opens one moment with three panels and a clean report', async ({ page }) => {
  const { pageErrors } = await openApp(page)
  const canvas = await describeCanvas(page)
  expect(canvas.moment?.name).toBe('A new moment')
  expect(await momentPickerNames(page)).toEqual(['A new moment'])
  expect(canvas.panels.map((panel) => panel.type)).toEqual(['spotify', 'slideshow', 'notes'])
  expect(canvas.panels.every((panel) => panel.visible && !panel.focusView)).toBe(true)
  await expectArchitectureReportPass(page)
  expect(pageErrors).toEqual([])
})

test('panels, hiding, settings and stacking order survive a reload', async ({ page }) => {
  await openApp(page)
  const music = await panelOfType(page, 'spotify')
  const images = await panelOfType(page, 'slideshow')

  // Add a panel and move it.
  const added = await addPanelFromToolbar(page, 'notes')
  await dragLocator(page, await titleOf(page, added.panelId), { dx: -80, dy: 140 })
  expect(geometryOf(await panelById(page, added.panelId))).not.toEqual(geometryOf(added))

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
  await expect.poll(async () => (await panelById(page, images.panelId)).config).toMatchObject({ shuffle: true, intervalMs: 5500 })

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

test('export writes a .moment.zip and import brings the moment back, listed in the picker at once', async ({ page }, testInfo) => {
  await openApp(page)
  const source = (await describeCanvas(page)).moment
  if (!source) throw new Error('No moment is open')

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
  await page.getByRole('button', { name: 'Export moment' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/\.moment\.zip$/)
  const archivePath = testInfo.outputPath(download.suggestedFilename())
  await download.saveAs(archivePath)

  await page.locator('.moment-toolbar input[type="file"]').setInputFiles(archivePath)
  await expect.poll(async () => (await describeCanvas(page)).moment?.id).not.toBe(source.id)
  const imported = (await describeCanvas(page)).moment
  if (!imported) throw new Error('No moment is open after the import')
  expect(imported.name).toBe(source.name)

  // The picker lists the imported moment straight away, and has it selected.
  // (A regression here once left it out until the next create or delete.)
  await expect(momentPicker(page)).toHaveValue(imported.id)
  const listed = await momentPicker(page).locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))
  expect(listed.sort()).toEqual([source.id, imported.id].sort())
  expect(await momentPickerNames(page)).toEqual([source.name, source.name])

  await waitForCanvas(page)
  await expect.poll(async () => (await describeCanvas(page)).panels.map(persistedShape)).toEqual(exported)
  await expectArchitectureReportPass(page)
})

test.describe('leaving the page right after an edit', () => {
  /**
   * Both saves the app makes on its own are on timers (a 300ms debounce for
   * the canvas, 500ms for a note), and tldraw hands store changes to its
   * listeners on the next animation frame. Freezing the page's clock takes
   * every one of those off the table, so the only way an edit can reach
   * storage is the flush the lifecycle event triggers.
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

  async function expectPersistedAfterReload(page: Page, momentId: string, panelId: string, movedTo: { x: number; y: number }) {
    await expect.poll(() => readStorage(page, momentId)).toMatchObject({
      found: true,
      panels: expect.arrayContaining([expect.objectContaining({ panelId, x: movedTo.x, y: movedTo.y })]),
      notes: expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('Written just before leaving.') })]),
    })
    await page.clock.resume()
    await page.reload()
    await waitForCanvas(page)
    await expect.poll(async () => (await panelById(page, panelId)).note?.content).toContain('Written just before leaving.')
    expect(geometryOf(await panelById(page, panelId))).toMatchObject(movedTo)
  }

  test('pagehide flushes the pending save', async ({ page }) => {
    await openApp(page)
    const momentId = (await describeCanvas(page)).moment?.id ?? ''
    const { notes, movedTo } = await editWithClockFrozen(page)
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    await expectPersistedAfterReload(page, momentId, notes.panelId, movedTo)
  })

  test('hiding the tab flushes the pending save', async ({ page }) => {
    await openApp(page)
    const momentId = (await describeCanvas(page)).moment?.id ?? ''
    const { notes, movedTo } = await editWithClockFrozen(page)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expectPersistedAfterReload(page, momentId, notes.panelId, movedTo)
  })
})

test('a canvas command during a moment switch is refused, and the switch completes', async ({ page }) => {
  await openApp(page)
  const first = (await describeCanvas(page)).moment?.name ?? ''
  await createMomentFromToolbar(page, 'Second moment')
  const secondLayout = (await describeCanvas(page)).panels.map(persistedShape)
  const secondNotes = await panelOfType(page, 'notes')

  // Slow the store down so the switch is observably in progress: every read
  // of a moment record waits a second and a half before answering.
  await page.evaluate(() => {
    const originalGet = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, ...args: [IDBValidKey | IDBKeyRange]) {
      const request = originalGet.apply(this, args)
      if (this.name !== 'moments' || this.transaction.mode !== 'readonly') return request
      return new Promise((resolve, reject) => {
        request.onsuccess = () => setTimeout(() => resolve(request.result), 1500)
        request.onerror = () => reject(request.error)
      }) as unknown as IDBRequest
    }
  })

  await momentPicker(page).selectOption({ label: first })
  await expect(dispatch(page, { kind: 'panel.move', panelId: secondNotes.panelId, x: 0, y: 0 }))
    .rejects.toThrow('Please wait for the current moment operation to finish.')

  await expect.poll(async () => (await describeCanvas(page)).moment?.name, { timeout: 15_000 }).toBe(first)
  await waitForCanvas(page)
  expect((await describeCanvas(page)).panels).toHaveLength(3)
  // The refused command left the other moment exactly as it was.
  await momentPicker(page).selectOption({ label: 'Second moment' })
  await expect.poll(async () => (await describeCanvas(page)).moment?.name, { timeout: 15_000 }).toBe('Second moment')
  await waitForCanvas(page)
  expect((await describeCanvas(page)).panels.map(persistedShape)).toEqual(secondLayout)
  await expectArchitectureReportPass(page)
})
