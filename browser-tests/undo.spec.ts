import { test, expect } from '@playwright/test'
import {
  choosePanelMenuItem,
  createMomentFromToolbar,
  describeCanvas,
  dragLocator,
  expectArchitectureReportPass,
  geometryOf,
  loadSampleImages,
  noteBodyOf,
  openApp,
  panelById,
  panelOfType,
  selectPanel,
  shapeOf,
  switchMoment,
  titleOf,
  undo,
} from './helpers'

/**
 * Undo across the tldraw/moment boundary. tldraw owns the history; the app
 * owns what a panel *is* (its note, its pictures) and which moment the
 * history belongs to. Each test here checks that an undo restores a whole
 * panel, stays inside its own moment, and takes exactly the steps a person
 * would expect.
 */

test.describe('delete and undo', () => {
  test('a deleted Notes panel comes back with its note, not as a husk', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    await page.keyboard.type('Keep this sentence.')
    await expect.poll(async () => (await panelById(page, notes.panelId)).note?.content).toContain('Keep this sentence.')
    const before = await panelById(page, notes.panelId)

    await selectPanel(page, notes.panelId)
    await page.keyboard.press('Delete')
    await expect.poll(async () => (await describeCanvas(page)).panels.map((panel) => panel.panelId)).not.toContain(notes.panelId)

    await undo(page)
    await expect.poll(async () => (await describeCanvas(page)).panels.map((panel) => panel.panelId)).toContain(notes.panelId)
    const restored = await panelById(page, notes.panelId)
    expect(geometryOf(restored)).toEqual(geometryOf(before))
    expect(restored.config).toEqual(before.config)
    expect(restored.note).toEqual(before.note)
    await expect(noteBodyOf(await shapeOf(page, notes.panelId))).toContainText('Keep this sentence.')
    await expectArchitectureReportPass(page)
  })

  test('a deleted Images panel comes back with its pictures', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    await loadSampleImages(page, images.panelId)
    const before = await panelById(page, images.panelId)

    await selectPanel(page, images.panelId)
    await page.keyboard.press('Delete')
    await expect.poll(async () => (await describeCanvas(page)).panels.map((panel) => panel.panelId)).not.toContain(images.panelId)

    await undo(page)
    await expect.poll(async () => (await describeCanvas(page)).panels.map((panel) => panel.panelId)).toContain(images.panelId)
    const restored = await panelById(page, images.panelId)
    expect(geometryOf(restored)).toEqual(geometryOf(before))
    expect(restored.config).toEqual(before.config)
    await expect((await shapeOf(page, images.panelId)).locator('img.slideshow-image-layer')).toBeVisible()
    await expectArchitectureReportPass(page)
  })
})

test.describe('undo after switching moments', () => {
  test('does not touch the moment just opened', async ({ page }) => {
    await openApp(page)
    const first = (await describeCanvas(page)).moment?.name ?? ''
    // Some history in the first moment, so there is something an undo could
    // wrongly reach for.
    const notes = await panelOfType(page, 'notes')
    await dragLocator(page, await titleOf(page, notes.panelId), { dx: -120, dy: 60 })
    const firstLayout = (await describeCanvas(page)).panels.map(geometryOf)

    await createMomentFromToolbar(page, 'Second moment')
    const secondLayout = (await describeCanvas(page)).panels.map(geometryOf)
    expect(secondLayout).toHaveLength(3)

    // Undo right after the switch: the new moment keeps all of its panels.
    await page.mouse.click(720, 860)
    await undo(page)
    await undo(page)
    expect((await describeCanvas(page)).moment?.name).toBe('Second moment')
    expect((await describeCanvas(page)).panels.map(geometryOf)).toEqual(secondLayout)

    // And back again: the first moment is as it was left, and undoing there
    // cannot reach into the second.
    await switchMoment(page, first)
    expect((await describeCanvas(page)).panels.map(geometryOf)).toEqual(firstLayout)
    await page.mouse.click(720, 860)
    await undo(page)
    await undo(page)
    expect((await describeCanvas(page)).panels).toHaveLength(3)
    await switchMoment(page, 'Second moment')
    expect((await describeCanvas(page)).panels.map(geometryOf)).toEqual(secondLayout)
    await expectArchitectureReportPass(page)
  })
})

test.describe('duplicate and undo', () => {
  test('Ctrl+D copies a panel and undo removes the copy, not the original', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    await loadSampleImages(page, images.panelId)
    const original = await panelById(page, images.panelId)

    await selectPanel(page, images.panelId)
    await page.keyboard.press('Control+d')
    await expect.poll(async () => (await describeCanvas(page)).panels.filter((panel) => panel.type === 'slideshow')).toHaveLength(2)
    const copy = (await describeCanvas(page)).panels.find((panel) => panel.type === 'slideshow' && panel.panelId !== images.panelId)
    expect(copy).toBeDefined()
    expect(copy?.panelId).not.toBe(images.panelId)
    await expectArchitectureReportPass(page)

    await undo(page)
    await expect.poll(async () => (await describeCanvas(page)).panels).toHaveLength(3)
    const afterUndo = await panelById(page, images.panelId)
    expect(geometryOf(afterUndo)).toEqual(geometryOf(original))
    expect(afterUndo.config).toEqual(original.config)
    await expect((await shapeOf(page, images.panelId)).locator('img.slideshow-image-layer')).toBeVisible()
    await expectArchitectureReportPass(page)
  })

  test('Alt-dragging a panel copies it and undo leaves the original in place', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const original = geometryOf(notes)

    await dragLocator(page, await titleOf(page, notes.panelId), { dx: -160, dy: 120 }, { alt: true })
    await expect.poll(async () => (await describeCanvas(page)).panels.filter((panel) => panel.type === 'notes')).toHaveLength(2)
    // tldraw's alt-drag leaves the original where it was and moves the copy.
    expect(geometryOf(await panelById(page, notes.panelId))).toEqual(original)
    await expectArchitectureReportPass(page)

    await undo(page)
    await expect.poll(async () => (await describeCanvas(page)).panels).toHaveLength(3)
    expect(geometryOf(await panelById(page, notes.panelId))).toEqual(original)
    await expectArchitectureReportPass(page)
  })
})

test.describe('focus view and undo', () => {
  test('entering focus view is one undo step', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    await loadSampleImages(page, images.panelId)
    // A move first, so a single undo that also reverted the move would show.
    // Kept well under the ~40px the canonical layout leaves between this
    // panel and Notes beside it: a bigger move drags the header's own ...
    // button under Notes, where a real overlap correctly blocks the click
    // that follows -- a click blocked by whatever panel is actually on top
    // there is the app working as intended, not a reason to force one.
    await dragLocator(page, await titleOf(page, images.panelId), { dx: 20, dy: 50 })
    const moved = geometryOf(await panelById(page, images.panelId))
    expect(moved).not.toEqual(geometryOf(images))

    await choosePanelMenuItem(await shapeOf(page, images.panelId), 'Reduce panel to focus view')
    await expect.poll(async () => (await panelById(page, images.panelId)).focusView).toBe(true)

    await page.mouse.click(720, 860)
    await undo(page)
    await expect.poll(async () => (await panelById(page, images.panelId)).focusView).toBe(false)
    expect(geometryOf(await panelById(page, images.panelId))).toEqual(moved)
    await expectArchitectureReportPass(page)
  })
})
