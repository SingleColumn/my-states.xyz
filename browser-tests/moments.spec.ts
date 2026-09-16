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
  switchMoment,
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

  // A moment named exactly like the source is already open, so re-importing
  // this file asks for confirmation before adding a same-named duplicate.
  page.once('dialog', (dialog) => void dialog.accept())
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

test('Duplicate moment makes an independent, already-open copy named "(copy)", never asking', async ({ page }) => {
  await openApp(page)
  const source = (await describeCanvas(page)).moment
  if (!source) throw new Error('No moment is open')
  const sourcePanels = (await describeCanvas(page)).panels.map(persistedShape)

  await page.getByRole('button', { name: 'Duplicate moment' }).click()
  await expect.poll(async () => (await describeCanvas(page)).moment?.id).not.toBe(source.id)
  const duplicate = (await describeCanvas(page)).moment
  if (!duplicate) throw new Error('No moment is open after duplicating')
  expect(duplicate.name).toBe(`${source.name} (copy)`)
  expect((await describeCanvas(page)).panels.map(persistedShape)).toEqual(sourcePanels)
  expect((await momentPickerNames(page)).sort()).toEqual([source.name, duplicate.name].sort())
  await expectArchitectureReportPass(page)
})

test('importing an archive whose name collides with an existing moment asks first, and declining adds nothing', async ({ page }, testInfo) => {
  await openApp(page)
  await createMomentFromToolbar(page, 'Kept aside')

  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export moment' }).click()
  const download = await downloading
  const archivePath = testInfo.outputPath(download.suggestedFilename())
  await download.saveAs(archivePath)

  // Switch away, so the collision is with a moment other than the one open
  // -- the warning is not limited to re-importing the currently open moment.
  await switchMoment(page, 'A new moment')
  const before = await momentPickerNames(page)

  let dialogMessage = ''
  page.once('dialog', (dialog) => { dialogMessage = dialog.message(); void dialog.dismiss() })
  await page.locator('.moment-toolbar input[type="file"]').setInputFiles(archivePath)
  await expect.poll(() => dialogMessage).toContain('"Kept aside"')
  // Declined: the open moment and the picker are unchanged.
  await expect.poll(async () => (await describeCanvas(page)).moment?.name).toBe('A new moment')
  expect(await momentPickerNames(page)).toEqual(before)
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

  async function expectFlushedToStorage(page: Page, momentId: string, panelId: string, movedTo: { x: number; y: number }) {
    await expect.poll(() => readStorage(page, momentId)).toMatchObject({
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
    const momentId = (await describeCanvas(page)).moment?.id ?? ''
    const { notes, movedTo } = await editWithClockFrozen(page)
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    await expectFlushedToStorage(page, momentId, notes.panelId, movedTo)
  })

  test('the tab-hidden handler writes the pending edit to storage', async ({ page }) => {
    await openApp(page)
    const momentId = (await describeCanvas(page)).moment?.id ?? ''
    const { notes, movedTo } = await editWithClockFrozen(page)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expectFlushedToStorage(page, momentId, notes.panelId, movedTo)
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
