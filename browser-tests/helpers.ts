import { expect, test, type Locator, type Page } from '@playwright/test'
import type { CanvasCommand, CanvasDescription, PanelDescription } from '../src/canvasApi'
import type { PanelType } from '../src/types'

/**
 * Shared vocabulary for the browser suite.
 *
 * The assertion oracle is `window.myStates.describe()` (src/canvasApi.ts):
 * a plain snapshot of the open moment straight from tldraw's store, which
 * is far more reliable than reading panel state back out of rendered DOM.
 * `dispatch()` is used only to *set up* a scenario (fill a note with enough
 * text to scroll, say) -- never in place of the pointer or keyboard
 * interaction a test exists to exercise.
 */

export type { CanvasCommand, CanvasDescription, PanelDescription }

/**
 * Loads the app in a fresh profile and waits for the first moment's panels.
 * On a themed project (playwright.config.ts) the project's theme is then
 * selected as the global theme, so every test that follows runs under it.
 */
export async function openApp(page: Page) {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await page.goto('/')
  await waitForCanvas(page)
  const themeId = test.info().project.metadata.themeId as string | undefined
  if (themeId) {
    await dispatch(page, { kind: 'appearance.setGlobalTheme', themeId })
    await expect.poll(async () => (await describeCanvas(page)).theme.id).toBe(themeId)
  }
  return {
    /** Uncaught exceptions in the page since it was opened. */
    pageErrors,
  }
}

export async function waitForCanvas(page: Page) {
  await page.waitForFunction(() => {
    const api = window.myStates
    return !!api && api.describe().panels.length > 0
  })
  // A panel is only pointable once its header is on screen. Any visible one
  // will do: a panel that was moved off screen still renders a header.
  await expect(page.locator('.tl-shape .card-header').filter({ visible: true }).first()).toBeVisible()
}

export async function describeCanvas(page: Page): Promise<CanvasDescription> {
  return page.evaluate(() => {
    if (!window.myStates) throw new Error('window.myStates is not mounted')
    return window.myStates.describe()
  })
}

export async function dispatch(page: Page, command: CanvasCommand) {
  await page.evaluate((cmd) => {
    if (!window.myStates) throw new Error('window.myStates is not mounted')
    return window.myStates.dispatch(cmd)
  }, command)
}

export async function panelOfType(page: Page, type: PanelType): Promise<PanelDescription> {
  const { panels } = await describeCanvas(page)
  const panel = panels.find((candidate) => candidate.type === type)
  if (!panel) throw new Error(`No ${type} panel on the canvas`)
  return panel
}

export async function panelById(page: Page, panelId: string): Promise<PanelDescription> {
  const { panels } = await describeCanvas(page)
  const panel = panels.find((candidate) => candidate.panelId === panelId)
  if (!panel) throw new Error(`No panel has the id ${panelId}`)
  return panel
}

export function geometryOf(panel: PanelDescription) {
  return { x: panel.x, y: panel.y, w: panel.w, h: panel.h }
}

/**
 * The tldraw shape element that renders a panel. The app exposes no shape
 * id, so identity comes from stacking order: describe() lists panels in
 * tldraw's sorted order and tldraw gives each rendered `.tl-shape` a
 * z-index in that same order, so the panel at `order` k is the element with
 * the k-th smallest z-index. Geometry is then checked as a guard; it cannot
 * be the key, because two panels can sit at exactly the same place (a new
 * panel is created at its type's default layout, on top of any panel still
 * there).
 */
export async function shapeOf(page: Page, panelId: string): Promise<Locator> {
  const panel = await panelById(page, panelId)
  const shapeId = await page.evaluate(({ order, x, y }) => {
    const shapes = [...document.querySelectorAll<HTMLElement>('.tl-shape')]
      .map((element) => ({ element, z: Number(element.style.zIndex) }))
      .filter((entry) => Number.isFinite(entry.z))
      .sort((left, right) => left.z - right.z)
    const candidate = shapes[order]?.element
    if (!candidate) return { shapeId: null, reason: `${shapes.length} rendered shapes, none at order ${order}` }
    const match = /matrix\(1, 0, 0, 1, (-?[\d.]+), (-?[\d.]+)\)/.exec(candidate.style.transform)
    if (!match || Math.abs(Number(match[1]) - x) >= 0.5 || Math.abs(Number(match[2]) - y) >= 0.5) {
      return { shapeId: null, reason: `shape at order ${order} is at "${candidate.style.transform}", not (${x}, ${y})` }
    }
    return { shapeId: candidate.dataset.shapeId ?? null, reason: '' }
  }, { order: panel.order, x: panel.x, y: panel.y })
  if (!shapeId.shapeId) throw new Error(`No rendered shape for panel ${panelId}: ${shapeId.reason}`)
  return page.locator(`.tl-shape[data-shape-id="${shapeId.shapeId}"]`)
}

/** The title in a panel's header: frame, so a press there is tldraw's. */
export async function titleOf(page: Page, panelId: string): Promise<Locator> {
  return (await shapeOf(page, panelId)).locator('.card-header .card-title')
}

/** The camera zoom, read from the transform tldraw puts on its HTML layer. */
export async function cameraZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>('.tl-html-layer')
    const match = layer && /scale\(([\d.]+)\)/.exec(layer.style.transform)
    return match ? Number(match[1]) : 1
  })
}

export async function cameraTransform(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector<HTMLElement>('.tl-html-layer')?.style.transform ?? '')
}

/**
 * tldraw writes the active cursor onto its container as a CSS variable
 * (`--tl-cursor`), and each tool sets its own: the select tool `default`,
 * the hand tool `grab`. It is the closest thing to reading
 * `editor.getCurrentToolId()` that the page exposes without a hook into the
 * editor, and it is derived from the editor's own instance state.
 */
export async function tldrawCursor(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector<HTMLElement>('.tl-container')?.style.getPropertyValue('--tl-cursor') ?? '')
}

/** A press-and-drag with real intermediate pointer moves, as tldraw needs. */
export async function dragFrom(page: Page, from: { x: number; y: number }, by: { dx: number; dy: number }, modifiers: { alt?: boolean } = {}) {
  await page.mouse.move(from.x, from.y)
  if (modifiers.alt) await page.keyboard.down('Alt')
  await page.mouse.down()
  await page.mouse.move(from.x + by.dx / 2, from.y + by.dy / 2, { steps: 6 })
  await page.mouse.move(from.x + by.dx, from.y + by.dy, { steps: 6 })
  await page.mouse.up()
  if (modifiers.alt) await page.keyboard.up('Alt')
}

export async function dragLocator(page: Page, locator: Locator, by: { dx: number; dy: number }, modifiers: { alt?: boolean } = {}) {
  await dragFrom(page, await centerOf(locator), by, modifiers)
}

export async function centerOf(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('The element has no box on screen')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * A click delivered as raw pointer events at an element's centre. Frame
 * elements (a panel title, say) are `pointer-events: none` by design so the
 * press falls through to tldraw's canvas; Playwright's `locator.click()`
 * refuses such a target as "intercepted", which here is the point.
 */
export async function clickAt(page: Page, locator: Locator, options: { button?: 'left' | 'right' } = {}) {
  const { x, y } = await centerOf(locator)
  await page.mouse.click(x, y, { button: options.button ?? 'left' })
}

/** Selects a panel the way a person does: a press on its title. */
export async function selectPanel(page: Page, panelId: string) {
  await clickAt(page, await titleOf(page, panelId))
}

/** The editable body of a Notes panel (MDXEditor renders a same-classed placeholder beside it). */
export function noteBodyOf(shape: Locator): Locator {
  return shape.locator('.notes-editor-content[contenteditable="true"]')
}

export async function undo(page: Page) {
  await page.keyboard.press('Control+z')
}

/**
 * Loads the first bundled sample collection into an Images panel through
 * its own empty-state picker and waits for the picture to be on screen.
 * Setup for the tests that need a picture, not the interaction under test.
 */
export async function loadSampleImages(page: Page, panelId: string) {
  const shape = await shapeOf(page, panelId)
  await shape.locator('.empty-stage .sample-collection-card').first().click()
  await expect(shape.locator('img.slideshow-image-layer')).toBeVisible()
  await expect.poll(async () => (await panelById(page, panelId)).config).toMatchObject({ imageSource: { type: 'bundled' } })
}

/** What the app's own IndexedDB holds for a moment, read with no help from the page's code. */
export async function readStorage(page: Page, momentId: string) {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('my-states')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const read = <T,>(store: string, run: (store: IDBObjectStore) => IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(store).objectStore(store))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    interface StoredShape { typeName: string; index: string; x: number; y: number; props: { panelId: string; w: number; h: number; visible: boolean; focusView: boolean; panel: { config: unknown } } }
    const moment = await read<{ document: { store: Record<string, StoredShape> } } | undefined>('moments', (store) => store.get(id))
    const notes = await read<Array<{ momentId: string; title: string; content: string; document?: { schemaVersion: number; doc: { content?: Array<{ type: string }> } } }>>('notes', (store) => store.getAll())
    db.close()
    const shapes = moment ? Object.values(moment.document.store).filter((record) => record.typeName === 'shape') : []
    shapes.sort((left, right) => (left.index < right.index ? -1 : left.index > right.index ? 1 : 0))
    return {
      found: !!moment,
      panels: shapes.map((shape, order) => ({ panelId: shape.props.panelId, x: shape.x, y: shape.y, w: shape.props.w, h: shape.props.h, visible: shape.props.visible, focusView: shape.props.focusView, order, config: shape.props.panel.config })),
      notes: notes.filter((note) => note.momentId === id).map((note) => ({ title: note.title, content: note.content, document: note.document ?? null })),
    }
  }, momentId)
}

/**
 * Waits until the stored document matches the canvas. Canvas saves are
 * debounced (300ms), and a flush started by `pagehide` does not survive the
 * unload that follows it, so a test that reloads right after an edit must
 * first let the save land -- as a person pausing for a moment would.
 */
export async function expectCanvasSaved(page: Page) {
  const canvas = await describeCanvas(page)
  if (!canvas.moment) throw new Error('No moment is open')
  const expected = canvas.panels.map(({ panelId, x, y, w, h, visible, focusView, order, config }) => ({ panelId, x, y, w, h, visible, focusView, order, config }))
  await expect.poll(async () => (await readStorage(page, canvas.moment!.id)).panels, { message: 'the stored document matches the canvas' }).toEqual(expected)
}

/** The panel report lives under Settings > Developer; opening it closes Settings. */
export async function openPanelReport(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('button', { name: 'Developer' }).click()
  await settings.getByRole('button', { name: 'Open panel report' }).click()
  await expect(settings).toBeHidden()
}

/**
 * The in-app Panel report (dev build only) validates panel/shape
 * cardinality, orphaned references and the schema version. Canvas saves are
 * debounced, so its "every shape is persisted" check can lag a mutation by a
 * few hundred milliseconds; the report is reopened until it settles.
 */
export async function expectArchitectureReportPass(page: Page) {
  await expect.poll(async () => {
    await openPanelReport(page)
    const dialog = page.getByRole('dialog', { name: 'Panel architecture report' })
    const status = (await dialog.locator('.architecture-report-status').textContent())?.trim()
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
    return status
  }, { message: 'panel architecture report status' }).toBe('PASS · 0 errors · 0 warnings')
}

/** Adds a panel from the toolbar's "Add panel" dropdown and returns it. */
export async function addPanelFromToolbar(page: Page, type: PanelType): Promise<PanelDescription> {
  const before = (await describeCanvas(page)).panels.map((panel) => panel.panelId)
  await page.getByRole('combobox', { name: 'Add panel' }).selectOption(type)
  await expect.poll(async () => (await describeCanvas(page)).panels.length).toBe(before.length + 1)
  const added = (await describeCanvas(page)).panels.find((panel) => !before.includes(panel.panelId))
  if (!added) throw new Error('The added panel is not on the canvas')
  return added
}

/** The moment picker in the toolbar. */
export function momentPicker(page: Page) {
  return page.getByRole('combobox', { name: 'Open moment' })
}

export async function momentPickerNames(page: Page): Promise<string[]> {
  return momentPicker(page).locator('option').allTextContents()
}

/** Creates a moment through the "New moment" button and its name prompt, then waits for it to open. */
export async function createMomentFromToolbar(page: Page, name: string) {
  page.once('dialog', (dialog) => void dialog.accept(name))
  await page.getByRole('button', { name: 'New moment' }).click()
  await expect.poll(async () => (await describeCanvas(page)).moment?.name).toBe(name)
  await waitForCanvas(page)
}

export async function switchMoment(page: Page, name: string) {
  await momentPicker(page).selectOption({ label: name })
  await expect.poll(async () => (await describeCanvas(page)).moment?.name).toBe(name)
  await waitForCanvas(page)
}
